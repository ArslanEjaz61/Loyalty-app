/**
 * Staff looking a customer up by number or name.
 *
 * The QR is the fast path; this is the fallback for a customer whose phone is
 * flat, or who has not opened the card yet. Staff-only, and it returns just
 * enough to confirm the right person is standing at the counter — never the
 * full profile.
 */

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db.js";
import { getStaffSession } from "../../../../lib/session.js";

export async function GET(req) {
  const session = await getStaffSession();
  if (!session) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  const q = (new URL(req.url).searchParams.get("q") || "").trim();
  if (q.length < 3) {
    return NextResponse.json({ error: "Enter at least 3 characters." }, { status: 400 });
  }

  const digits = q.replace(/\D/g, "");
  const where = {
    isBlocked: false,
    OR: [
      { name: { contains: q, mode: "insensitive" } },
      ...(digits.length >= 3 ? [{ mobile: { contains: digits } }] : []),
    ],
  };

  const customers = await prisma.customer.findMany({
    where,
    include: {
      homeBranch: { select: { name: true, city: true } },
      customerRewards: {
        where: { status: "AVAILABLE" },
        include: { reward: true },
        orderBy: { issuedAt: "asc" },
      },
    },
    orderBy: { lastVisitAt: "desc" },
    take: 10,
  });

  const now = new Date();

  return NextResponse.json({
    ok: true,
    customers: customers.map((c) => ({
      id: c.id,
      name: c.name,
      // Masked — staff need enough to confirm identity, not the whole number.
      mobile: c.mobile.length > 4 ? `••••${c.mobile.slice(-4)}` : c.mobile,
      pointsBalance: c.pointsBalance,
      visitCount: c.visitCount,
      totalSpend: Number(c.totalSpend),
      lastVisitAt: c.lastVisitAt,
      homeBranch: c.homeBranch,
      memberSince: c.createdAt,
      availableRewards: c.customerRewards
        .filter((cr) => !cr.expiresAt || cr.expiresAt > now)
        .map((cr) => ({
          id: cr.id,
          name: cr.reward.name,
          description: cr.reward.description,
          value: Number(cr.reward.value),
          isPercent: cr.reward.isPercent,
          expiresAt: cr.expiresAt,
        })),
    })),
  });
}
