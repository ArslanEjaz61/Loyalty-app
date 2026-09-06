/**
 * Step 2: check the code, then create the account (or sign the customer in).
 *
 * The account is created here and nowhere else, so a number that never confirms
 * leaves no trace. New customers also receive the welcome reward in the same
 * transaction — either both happen or neither does.
 */

import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/db.js";
import { normalizeMobile, DEFAULT_COUNTRY } from "../../../../lib/mobile.js";
import { verifySecret } from "../../../../lib/crypto.js";
import { setCustomerSession } from "../../../../lib/session.js";
import { getNumber } from "../../../../lib/loyalty.js";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { mobile, countryCode, code, mode } = body || {};
  const purpose = mode === "login" ? "login" : "register";
  // Must use the same country code as step 1, or the lookup misses the OtpCode.
  const normalized = normalizeMobile(mobile, countryCode || DEFAULT_COUNTRY);

  if (!normalized || !code) {
    return NextResponse.json({ error: "Enter the code we sent you." }, { status: 400 });
  }

  const otp = await prisma.otpCode.findFirst({
    where: { mobile: normalized, purpose, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });

  if (!otp) {
    return NextResponse.json({ error: "No code was requested. Please start again." }, { status: 400 });
  }
  if (otp.expiresAt < new Date()) {
    return NextResponse.json({ error: "That code has expired. Please request a new one." }, { status: 400 });
  }

  const maxAttempts = await getNumber("otp_max_attempts");
  if (otp.attempts >= maxAttempts) {
    return NextResponse.json(
      { error: "Too many wrong attempts. Please request a new code." },
      { status: 429 }
    );
  }

  const valid = await verifySecret(String(code).trim(), otp.codeHash);
  if (!valid) {
    await prisma.otpCode.update({
      where: { id: otp.id },
      data: { attempts: { increment: 1 } },
    });
    const left = maxAttempts - (otp.attempts + 1);
    return NextResponse.json(
      { error: left > 0 ? `Wrong code. ${left} attempt${left === 1 ? "" : "s"} left.` : "Wrong code." },
      { status: 400 }
    );
  }

  // ---- correct code from here on

  await prisma.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });

  if (purpose === "login") {
    const customer = await prisma.customer.findUnique({ where: { mobile: normalized } });
    if (!customer) {
      return NextResponse.json({ error: "No account found for this number." }, { status: 404 });
    }
    await setCustomerSession(customer.id);
    return NextResponse.json({ ok: true, customerId: customer.id, isNew: false });
  }

  // Guard against two tabs finishing registration at once.
  const alreadyThere = await prisma.customer.findUnique({ where: { mobile: normalized } });
  if (alreadyThere) {
    await setCustomerSession(alreadyThere.id);
    return NextResponse.json({ ok: true, customerId: alreadyThere.id, isNew: false });
  }

  const welcome = await prisma.reward.findFirst({ where: { type: "WELCOME", isActive: true } });

  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({
      data: {
        mobile: normalized,
        name: otp.pendingName || "Guest",
        email: otp.pendingEmail || null,
        birthday: otp.pendingBirthday || null,
        homeBranchId: otp.pendingBranchId || null,
      },
    });

    if (welcome) {
      await tx.customerReward.create({
        data: {
          customerId: created.id,
          rewardId: welcome.id,
          status: "AVAILABLE",
          expiresAt: welcome.validDays
            ? new Date(Date.now() + welcome.validDays * 86400_000)
            : null,
        },
      });
    }

    await tx.auditLog.create({
      data: {
        action: "customer.register",
        entityType: "Customer",
        entityId: created.id,
        metadata: { mobile: normalized, branchId: otp.pendingBranchId ?? null },
      },
    });

    return created;
  });

  await setCustomerSession(customer.id);

  return NextResponse.json({ ok: true, customerId: customer.id, isNew: true });
}
