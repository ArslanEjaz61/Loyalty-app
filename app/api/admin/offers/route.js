/**
 * Offers and campaigns, for management.
 *
 * An offer with no branch rows runs everywhere; listing branch ids scopes it to
 * those locations. Branch managers can read the list but not change it —
 * campaigns are a company-level decision.
 */

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db.js";
import { requireAdmin } from "../../../../lib/adminScope.js";
import { canAccessAllBranches } from "../../../../lib/session.js";

export async function GET() {
  const { error, status, session } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status });

  const offers = await prisma.offer.findMany({
    include: { branches: { include: { branch: { select: { id: true, name: true, city: true } } } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  const branches = await prisma.branch.findMany({
    where: { isActive: true },
    select: { id: true, code: true, name: true, city: true },
    orderBy: [{ code: "asc" }],
  });

  const now = new Date();

  return NextResponse.json({
    ok: true,
    canEdit: canAccessAllBranches(session.role),
    branches,
    offers: offers.map((o) => ({
      id: o.id,
      name: o.name,
      description: o.description,
      value: Number(o.discountValue),
      isPercent: o.isPercent,
      segment: o.segment,
      startsAt: o.startsAt,
      endsAt: o.endsAt,
      isActive: o.isActive,
      // "Live" is the answer people actually want: active, started, not expired.
      isLive:
        o.isActive &&
        (!o.startsAt || o.startsAt <= now) &&
        (!o.endsAt || o.endsAt >= now),
      branches: o.branches.map((b) => b.branch),
      createdAt: o.createdAt,
    })),
  });
}

export async function POST(req) {
  const { error, status, session } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status });
  if (!canAccessAllBranches(session.role)) {
    return NextResponse.json({ error: "Only admins can create offers." }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { name, description, value, isPercent, branchIds, startsAt, endsAt, segment } = body || {};

  if (!name || String(name).trim().length < 2) {
    return NextResponse.json({ error: "Give the offer a name." }, { status: 400 });
  }
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Enter a discount value above zero." }, { status: 400 });
  }
  if (isPercent && amount > 100) {
    return NextResponse.json({ error: "A percentage discount cannot exceed 100." }, { status: 400 });
  }

  const start = startsAt ? new Date(startsAt) : null;
  const end = endsAt ? new Date(endsAt) : null;
  if (start && Number.isNaN(start.getTime())) {
    return NextResponse.json({ error: "Invalid start date." }, { status: 400 });
  }
  if (end && Number.isNaN(end.getTime())) {
    return NextResponse.json({ error: "Invalid end date." }, { status: 400 });
  }
  if (start && end && end < start) {
    return NextResponse.json({ error: "The end date is before the start date." }, { status: 400 });
  }

  const ids = Array.isArray(branchIds) ? branchIds.filter(Boolean) : [];

  const offer = await prisma.offer.create({
    data: {
      name: String(name).trim(),
      description: description ? String(description).trim() : null,
      discountValue: amount,
      isPercent: Boolean(isPercent),
      segment: segment ? String(segment).trim() : null,
      startsAt: start,
      endsAt: end,
      isActive: true,
      branches: ids.length ? { create: ids.map((branchId) => ({ branchId })) } : undefined,
    },
  });

  await prisma.auditLog.create({
    data: {
      staffId: session.id,
      action: "offer.create",
      entityType: "Offer",
      entityId: offer.id,
      metadata: { name: offer.name, value: amount, isPercent: Boolean(isPercent), branchIds: ids },
    },
  });

  return NextResponse.json({ ok: true, offer: { id: offer.id, name: offer.name } });
}

export async function PATCH(req) {
  const { error, status, session } = await requireAdmin();
  if (error) return NextResponse.json({ error }, { status });
  if (!canAccessAllBranches(session.role)) {
    return NextResponse.json({ error: "Only admins can change offers." }, { status: 403 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { id, isActive } = body || {};
  if (!id) return NextResponse.json({ error: "Which offer?" }, { status: 400 });
  if (typeof isActive !== "boolean") {
    return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  }

  const offer = await prisma.offer.update({ where: { id: String(id) }, data: { isActive } });

  await prisma.auditLog.create({
    data: {
      staffId: session.id,
      action: isActive ? "offer.activate" : "offer.deactivate",
      entityType: "Offer",
      entityId: offer.id,
      metadata: { name: offer.name },
    },
  });

  return NextResponse.json({ ok: true });
}
