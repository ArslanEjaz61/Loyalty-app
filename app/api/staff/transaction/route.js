/**
 * Records a visit: the bill, the points, and any reward redeemed.
 *
 * Two rules from the requirements are enforced here rather than in the UI,
 * because the UI is not what a determined cashier would go around:
 *
 *   1. Points are calculated on the server from the amount. The request cannot
 *      supply a points figure.
 *   2. An invoice number already used at this branch is refused, so one bill
 *      cannot be scanned twice.
 *
 * Everything is written inside one database transaction — a half-recorded visit
 * that awards points but forgets the reward would be worse than a failure.
 */

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db.js";
import { getStaffSession, canAccessBranch } from "../../../../lib/session.js";
import { pointsForAmount, newlyEligibleRewards, getNumber } from "../../../../lib/loyalty.js";
import { normalizeCode } from "../../../../lib/crypto.js";

export async function POST(req) {
  const session = await getStaffSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const {
    token: rawToken,
    customerId: lookedUpCustomerId,
    invoiceNumber,
    amount,
    redeemRewardId,
  } = body || {};

  const token = normalizeCode(rawToken);
  const invoice = String(invoiceNumber || "").trim();
  const value = Number(amount);

  if (!token && !lookedUpCustomerId) {
    return NextResponse.json({ error: "Scan or look up the customer first." }, { status: 400 });
  }
  if (!invoice) return NextResponse.json({ error: "Enter the invoice number." }, { status: 400 });
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "Enter a valid bill amount." }, { status: 400 });
  }

  // Two ways in: a scanned/typed QR code, or a customer the signed-in staff
  // member looked up by name or number. Both are staff-initiated.
  let qr = null;
  let customer;
  if (token) {
    qr = await prisma.qrToken.findUnique({ where: { token }, include: { customer: true } });
    if (!qr) return NextResponse.json({ error: "Code not recognised." }, { status: 404 });
    if (qr.usedAt) return NextResponse.json({ error: "This code has already been used." }, { status: 409 });
    if (qr.expiresAt < new Date()) {
      return NextResponse.json({ error: "The code expired. Please scan again." }, { status: 410 });
    }
    customer = qr.customer;
  } else {
    customer = await prisma.customer.findUnique({ where: { id: String(lookedUpCustomerId) } });
    if (!customer) return NextResponse.json({ error: "Customer not found." }, { status: 404 });
  }

  if (customer.isBlocked) {
    return NextResponse.json({ error: "This account is not active." }, { status: 403 });
  }

  // Cashiers are tied to their branch; an admin acting at a till must say which.
  const branchId = session.branchId || body?.branchId;
  if (!branchId) {
    return NextResponse.json({ error: "No branch selected." }, { status: 400 });
  }
  if (!canAccessBranch(session, branchId)) {
    return NextResponse.json({ error: "You cannot record a sale for that branch." }, { status: 403 });
  }

  const duplicate = await prisma.transaction.findFirst({
    where: { branchId, invoiceNumber: invoice },
  });
  if (duplicate) {
    await prisma.auditLog.create({
      data: {
        staffId: session.id,
        action: "transaction.duplicate_blocked",
        entityType: "Transaction",
        entityId: duplicate.id,
        metadata: { invoiceNumber: invoice, branchId },
      },
    });
    return NextResponse.json(
      { error: `Invoice ${invoice} has already been used at this branch.` },
      { status: 409 }
    );
  }

  const customerId = customer.id;
  const pointsEarned = await pointsForAmount(value);
  const expiryDays = await getNumber("points_expiry_days");

  // Validate the redemption before opening the write transaction.
  let redeeming = null;
  // A points reward costs what it was priced at — redeeming it spends the
  // points rather than leaving the balance untouched.
  let pointsSpent = 0;
  if (redeemRewardId) {
    redeeming = await prisma.customerReward.findFirst({
      where: { id: redeemRewardId, customerId, status: "AVAILABLE" },
      include: { reward: true },
    });
    if (!redeeming) {
      return NextResponse.json({ error: "That reward is no longer available." }, { status: 409 });
    }
    if (redeeming.expiresAt && redeeming.expiresAt < new Date()) {
      return NextResponse.json({ error: "That reward has expired." }, { status: 409 });
    }
    if (redeeming.reward.type === "POINTS") {
      pointsSpent = redeeming.reward.threshold;
      if (customer.pointsBalance < pointsSpent) {
        return NextResponse.json(
          { error: `This reward costs ${pointsSpent} points and the balance is ${customer.pointsBalance}.` },
          { status: 409 }
        );
      }
    }
  }

  const discountGiven = redeeming
    ? redeeming.reward.isPercent
      ? Math.round(value * (Number(redeeming.reward.value) / 100) * 100) / 100
      : Number(redeeming.reward.value)
    : 0;

  const result = await prisma.$transaction(async (tx) => {
    const trx = await tx.transaction.create({
      data: {
        customerId,
        branchId,
        staffId: session.id,
        invoiceNumber: invoice,
        amount: value,
        pointsEarned,
        discountGiven,
      },
    });

    await tx.pointsLedger.create({
      data: {
        customerId,
        transactionId: trx.id,
        delta: pointsEarned,
        reason: "purchase",
        expiresAt: expiryDays > 0 ? new Date(Date.now() + expiryDays * 86400_000) : null,
      },
    });

    if (redeeming) {
      await tx.customerReward.update({
        where: { id: redeeming.id },
        data: { status: "REDEEMED", redeemedAt: new Date(), redeemedTxId: trx.id },
      });

      if (pointsSpent > 0) {
        // Its own ledger row, so the statement reads as earn-then-spend rather
        // than one netted figure nobody can explain later.
        await tx.pointsLedger.create({
          data: {
            customerId,
            transactionId: trx.id,
            delta: -pointsSpent,
            reason: "reward_redemption",
          },
        });
      }
    }

    const updatedCustomer = await tx.customer.update({
      where: { id: customerId },
      data: {
        pointsBalance: { increment: pointsEarned - pointsSpent },
        visitCount: { increment: 1 },
        totalSpend: { increment: value },
        lastVisitAt: new Date(),
      },
    });

    // Burn the QR so the same scan cannot be replayed. Nothing to burn when
    // staff found the customer by look-up instead.
    if (qr) {
      await tx.qrToken.update({ where: { id: qr.id }, data: { usedAt: new Date() } });
    }

    await tx.auditLog.create({
      data: {
        staffId: session.id,
        action: "transaction.create",
        entityType: "Transaction",
        entityId: trx.id,
        metadata: {
          customerId,
          branchId,
          invoiceNumber: invoice,
          amount: value,
          pointsEarned,
          pointsSpent,
          redeemedRewardId: redeeming?.id ?? null,
          via: qr ? "qr" : "staff_lookup",
        },
      },
    });

    return { trx, customer: updatedCustomer };
  });

  // Anything the new totals just unlocked.
  const held = await prisma.customerReward.findMany({
    where: { customerId, status: "AVAILABLE" },
    select: { rewardId: true },
  });

  const unlocked = await newlyEligibleRewards({
    pointsBalance: result.customer.pointsBalance,
    visitCount: result.customer.visitCount,
    alreadyHeldRewardIds: held.map((h) => h.rewardId),
  });

  const issued = [];
  for (const r of unlocked) {
    const cr = await prisma.customerReward.create({
      data: {
        customerId,
        rewardId: r.id,
        status: "AVAILABLE",
        expiresAt: r.validDays ? new Date(Date.now() + r.validDays * 86400_000) : null,
      },
    });
    issued.push({ id: cr.id, name: r.name, description: r.description });
  }

  return NextResponse.json({
    ok: true,
    transaction: {
      id: result.trx.id,
      invoiceNumber: invoice,
      amount: value,
      pointsEarned,
      pointsSpent,
      discountGiven,
    },
    customer: {
      name: result.customer.name,
      pointsBalance: result.customer.pointsBalance,
      visitCount: result.customer.visitCount,
    },
    redeemed: redeeming ? { name: redeeming.reward.name } : null,
    newRewards: issued,
  });
}
