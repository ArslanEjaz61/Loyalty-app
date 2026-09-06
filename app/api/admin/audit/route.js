/**
 * Audit trail — who did what, and the transactions a duplicate invoice blocked.
 *
 * Restricted to admins above cashier level, since it exposes staff behaviour.
 */

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db.js";
import { requireAdmin } from "../../../../lib/adminScope.js";

const PAGE_SIZE = 30;

export async function GET(req) {
  const auth = await requireAdmin();
  if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const { searchParams } = new URL(req.url);
  const page = Math.max(1, Number(searchParams.get("page") || 1));
  const action = searchParams.get("action") || "";

  const where = action ? { action } : {};

  const [total, rows, blocked] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({
      where,
      include: { staff: { select: { name: true, username: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where: { action: "transaction.duplicate_blocked" } }),
  ]);

  return NextResponse.json({
    entries: rows.map((a) => ({
      id: a.id,
      action: a.action,
      staff: a.staff?.name ?? "system",
      entityType: a.entityType,
      entityId: a.entityId,
      reason: a.reason,
      metadata: a.metadata,
      createdAt: a.createdAt,
    })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    duplicatesBlocked: blocked,
  });
}
