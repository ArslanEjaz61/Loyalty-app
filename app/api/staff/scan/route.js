/**
 * Staff scans a customer QR: turn the token into a loyalty profile.
 *
 * Read-only. The token is not consumed here, because a cashier may scan, then
 * discover the customer is not ready to pay, and scan again — burning the token
 * on a look-up would be hostile. It is consumed when the transaction is saved.
 */

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db.js";
import { getStaffSession } from "../../../../lib/session.js";
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

  // Typed by hand or read by the camera — both land here in any casing.
  const token = normalizeCode(body?.token);
  if (!token) {
    return NextResponse.json({ error: "No code scanned." }, { status: 400 });
  }

  const qr = await prisma.qrToken.findUnique({
    where: { token },
    include: {
      customer: {
        include: {
          homeBranch: { select: { name: true, city: true } },
          customerRewards: {
            where: { status: "AVAILABLE" },
            include: { reward: true },
            orderBy: { issuedAt: "asc" },
          },
        },
      },
    },
  });

  if (!qr) {
    return NextResponse.json({ error: "Code not recognised. Ask the customer to refresh their card." }, { status: 404 });
  }
  if (qr.usedAt) {
    return NextResponse.json({ error: "This code has already been used." }, { status: 409 });
  }
  if (qr.expiresAt < new Date()) {
    return NextResponse.json(
      { error: "This code has expired. Ask the customer to show their card again." },
      { status: 410 }
    );
  }

  const c = qr.customer;
  if (c.isBlocked) {
    return NextResponse.json({ error: "This account is not active." }, { status: 403 });
  }

  // Rewards that have quietly passed their expiry are not offered.
  const now = new Date();
  const rewards = c.customerRewards.filter((cr) => !cr.expiresAt || cr.expiresAt > now);

  return NextResponse.json({
    ok: true,
    token,
    customer: {
      id: c.id,
      name: c.name,
      mobile: c.mobile,
      pointsBalance: c.pointsBalance,
      visitCount: c.visitCount,
      totalSpend: Number(c.totalSpend),
      lastVisitAt: c.lastVisitAt,
      homeBranch: c.homeBranch,
      memberSince: c.createdAt,
    },
    availableRewards: rewards.map((cr) => ({
      id: cr.id,
      name: cr.reward.name,
      description: cr.reward.description,
      value: Number(cr.reward.value),
      isPercent: cr.reward.isPercent,
      expiresAt: cr.expiresAt,
    })),
  });
}
