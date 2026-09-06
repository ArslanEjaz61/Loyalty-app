import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db.js";
import { verifySecret } from "../../../../lib/crypto.js";
import { setStaffSession } from "../../../../lib/session.js";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { username, pin } = body || {};
  if (!username || !pin) {
    return NextResponse.json({ error: "Enter your username and PIN." }, { status: 400 });
  }

  const staff = await prisma.staff.findUnique({
    where: { username: String(username).trim().toLowerCase() },
    include: { branch: { select: { id: true, name: true, city: true } } },
  });

  // Same message whether the username or the PIN was wrong, so the form cannot
  // be used to discover valid usernames.
  const bad = NextResponse.json({ error: "Wrong username or PIN." }, { status: 401 });

  if (!staff || !staff.isActive) return bad;
  if (!(await verifySecret(String(pin).trim(), staff.pinHash))) return bad;

  await prisma.staff.update({ where: { id: staff.id }, data: { lastLogin: new Date() } });
  await setStaffSession(staff);

  return NextResponse.json({
    ok: true,
    staff: {
      id: staff.id,
      name: staff.name,
      role: staff.role,
      branch: staff.branch,
    },
  });
}
