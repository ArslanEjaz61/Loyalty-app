/**
 * Records a visit straight from the customer's own card page.
 *
 * There is no separate staff app or staff session here: the customer is
 * already identified by their own signed-in session, and the vendor proves
 * they are really at the counter by typing their own username + PIN into the
 * same page — the same credential a staff login would use, just entered
 * inline instead of behind a separate sign-in screen. This mirrors how The
 * Entertainer / Esaad redemptions work: the customer holds the phone, staff
 * only ever enters a short code to validate.
 *
 * Points are still calculated on the server from the amount, and a duplicate
 * invoice at the same branch is still refused — nothing about those
 * protections changes just because the identification method did.
 */

import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db.js";
import { getCustomerId } from "../../../lib/session.js";
import { verifySecret } from "../../../lib/crypto.js";
import { pointsForAmount, newlyEligibleRewards, getNumber } from "../../../lib/loyalty.js";

export async function POST(req) {
  const customerId = await getCustomerId();
  if (!customerId) {
    return NextResponse.json({ error: "Please sign in first." }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { staffUsername, staffPin, invoiceNumber, amount, redeemRewardId } = body || {};

  const invoice = String(invoiceNumber || "").trim();
  const value = Number(amount);

  if (!staffUsername || !staffPin) {
    return NextResponse.json({ error: "Ask the staff member to enter their code." }, { status: 400 });
  }
  if (!invoice) return NextResponse.json({ error: "Enter the invoice number." }, { status: 400 });
  if (!Number.isFinite(value) || value <= 0) {
    return NextResponse.json({ error: "Enter a valid bill amount." }, { status: 400 });
  }

  const staff = await prisma.staff.findUnique({
    where: { username: String(staffUsername).trim().toLowerCase() },
  });

  // Same message whether the username or the PIN was wrong, so this field
  // cannot be used to discover valid staff usernames.
  const badStaff = NextResponse.json({ error: "Wrong staff code." }, { status: 401 });
  if (!staff || !staff.isActive) return badStaff;
  if (!(await verifySecret(String(staffPin).trim(), staff.pinHash))) return badStaff;

  const branchId = staff.branchId;
  if (!branchId) {
    return NextResponse.json({ error: "This staff code is not tied to a branch." }, { status: 400 });
  }

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer || customer.isBlocked) {
    return NextResponse.json({ error: "This account is not active." }, { status: 403 });
  }

  const duplicate = await prisma.transaction.findFirst({
    where: { branchId, invoiceNumber: invoice },
  });
  if (duplicate) {
    await prisma.auditLog.create({
      data: {
        staffId: staff.id,
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

  const pointsEarned = await pointsForAmount(value);
  const expiryDays = await getNumber("points_expiry_days");

  let redeeming = null;
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
        staffId: staff.id,
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
    }

    const updatedCustomer = await tx.customer.update({
      where: { id: customerId },
      data: {
        pointsBalance: { increment: pointsEarned },
        visitCount: { increment: 1 },
        totalSpend: { increment: value },
        lastVisitAt: new Date(),
      },
    });

    await tx.staff.update({ where: { id: staff.id }, data: { lastLogin: new Date() } });

    await tx.auditLog.create({
      data: {
        staffId: staff.id,
        action: "transaction.create",
        entityType: "Transaction",
        entityId: trx.id,
        metadata: {
          customerId,
          branchId,
          invoiceNumber: invoice,
          amount: value,
          pointsEarned,
          redeemedRewardId: redeeming?.id ?? null,
          via: "customer_page_inline_code",
        },
      },
    });

    return { trx, customer: updatedCustomer };
  });

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
      discountGiven,
    },
    customer: {
      pointsBalance: result.customer.pointsBalance,
      visitCount: result.customer.visitCount,
    },
    redeemed: redeeming ? { name: redeeming.reward.name } : null,
    newRewards: issued,
  });
}
