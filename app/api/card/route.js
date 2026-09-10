/**
 * The loyalty card: profile, balances, rewards, and a fresh QR.
 *
 * A new short-lived token is minted on every load and the previous ones are
 * cleared, so a screenshot stops working almost immediately — which is the
 * point of the rotating QR.
 */

import { NextResponse } from "next/server";
import QRCode from "qrcode";
import { prisma } from "../../../lib/db.js";
import { getCustomerId } from "../../../lib/session.js";
import { randomCode, formatCode } from "../../../lib/crypto.js";
import { getNumber, getSettings } from "../../../lib/loyalty.js";

export async function GET() {
  const customerId = await getCustomerId();
  if (!customerId) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const customer = await prisma.customer.findUnique({
    where: { id: customerId },
    include: { homeBranch: { select: { id: true, name: true, city: true } } },
  });

  if (!customer || customer.isBlocked) {
    return NextResponse.json({ error: "Account not available." }, { status: 403 });
  }

  const ttl = await getNumber("qr_token_ttl_seconds");
  const settings = await getSettings();

  // Retire outstanding tokens before issuing the new one.
  await prisma.qrToken.deleteMany({ where: { customerId, usedAt: null } });

  // Retry on the vanishingly unlikely chance the code is already taken.
  let token = randomCode(8);
  const expiresAt = new Date(Date.now() + ttl * 1000);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await prisma.qrToken.create({ data: { token, customerId, expiresAt } });
      break;
    } catch (e) {
      if (e?.code !== "P2002" || attempt === 4) throw e;
      token = randomCode(8);
    }
  }

  const qr = await QRCode.toDataURL(token, {
    margin: 1,
    width: 360,
    errorCorrectionLevel: "M",
    color: { dark: "#141414", light: "#FFFFFF" },
  });

  const rewards = await prisma.customerReward.findMany({
    where: { customerId },
    include: { reward: true },
    orderBy: [{ status: "asc" }, { issuedAt: "desc" }],
    take: 30,
  });

  const transactions = await prisma.transaction.findMany({
    where: { customerId, isReversed: false },
    include: { branch: { select: { name: true, city: true } } },
    orderBy: { createdAt: "desc" },
    take: 15,
  });

  // What they have not unlocked yet, so the card can show something to aim at.
  const allRewards = await prisma.reward.findMany({
    where: { isActive: true, type: { in: ["POINTS", "VISITS"] } },
    orderBy: { threshold: "asc" },
  });

  // Offers with no branch rows are company-wide; the rest only show at the
  // branches they were scoped to.
  const now = new Date();
  const offerRows = await prisma.offer.findMany({
    where: {
      isActive: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
      ],
    },
    include: { branches: { select: { branchId: true } } },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  const offers = offerRows
    .filter((o) => o.branches.length === 0 || o.branches.some((b) => b.branchId === customer.homeBranchId))
    .map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      value: Number(o.discountValue),
      isPercent: o.isPercent,
      endsAt: o.endsAt,
      everywhere: o.branches.length === 0,
    }));

  const nextTargets = allRewards
    .map((r) => {
      if (r.type === "POINTS") {
        const need = r.threshold - customer.pointsBalance;
        return need > 0 ? { name: r.name, kind: "points", need } : null;
      }
      const into = customer.visitCount % r.threshold;
      const need = r.threshold - into;
      return { name: r.name, kind: "visits", need };
    })
    .filter(Boolean)
    .slice(0, 2);

  return NextResponse.json({
    customer: {
      id: customer.id,
      name: customer.name,
      mobile: customer.mobile,
      email: customer.email,
      birthday: customer.birthday,
      language: customer.language,
      homeBranch: customer.homeBranch,
      pointsBalance: customer.pointsBalance,
      visitCount: customer.visitCount,
      totalSpend: Number(customer.totalSpend),
      lastVisitAt: customer.lastVisitAt,
      memberSince: customer.createdAt,
    },
    // The code is shown under the QR so staff can type it when the camera is
    // unavailable — on iOS Safari there is no barcode API at all.
    qr: { image: qr, code: formatCode(token), expiresAt, ttlSeconds: ttl },
    rewards: rewards.map((cr) => ({
      id: cr.id,
      name: cr.reward.name,
      description: cr.reward.description,
      status: cr.status,
      value: Number(cr.reward.value),
      isPercent: cr.reward.isPercent,
      expiresAt: cr.expiresAt,
      redeemedAt: cr.redeemedAt,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      branch: t.branch.name,
      city: t.branch.city,
      amount: Number(t.amount),
      pointsEarned: t.pointsEarned,
      createdAt: t.createdAt,
    })),
    offers,
    nextTargets,
    currency: settings.currency,
  });
}
