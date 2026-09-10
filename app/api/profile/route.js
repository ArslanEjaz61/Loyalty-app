/**
 * The customer editing their own profile.
 *
 * Deliberately narrow: name, birthday, email and language only. The mobile
 * number is the login identity and is not editable here, and nothing that
 * touches points, visits or rewards is reachable from this route — those are
 * staff-side actions by design.
 */

import { NextResponse } from "next/server";
import { prisma } from "../../../lib/db.js";
import { getCustomerId } from "../../../lib/session.js";
import { isValidEmail } from "../../../lib/mobile.js";

export async function PATCH(req) {
  const customerId = await getCustomerId();
  if (!customerId) {
    return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const { name, email, birthday, language } = body || {};
  const data = {};

  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (trimmed.length < 2) {
      return NextResponse.json({ error: "Please enter your full name." }, { status: 400 });
    }
    data.name = trimmed;
  }

  if (email !== undefined) {
    const trimmed = String(email).trim();
    if (!isValidEmail(trimmed)) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    data.email = trimmed;
  }

  if (birthday !== undefined) {
    if (!birthday) {
      data.birthday = null;
    } else {
      const parsed = new Date(birthday);
      if (Number.isNaN(parsed.getTime())) {
        return NextResponse.json({ error: "Please enter a valid date of birth." }, { status: 400 });
      }
      if (parsed > new Date()) {
        return NextResponse.json({ error: "Date of birth cannot be in the future." }, { status: 400 });
      }
      data.birthday = parsed;
    }
  }

  if (language !== undefined) {
    const lang = String(language).trim().toLowerCase();
    if (!["en", "ar"].includes(lang)) {
      return NextResponse.json({ error: "Unsupported language." }, { status: 400 });
    }
    data.language = lang;
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
  }

  const customer = await prisma.customer.update({
    where: { id: customerId },
    data,
    select: { name: true, email: true, birthday: true, language: true },
  });

  return NextResponse.json({ ok: true, customer });
}
