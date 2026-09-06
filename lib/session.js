/**
 * Signed cookie sessions for both audiences.
 *
 * Customers and staff are deliberately separate cookies: a cashier's till
 * session must never be mistaken for a customer session, and someone can be
 * both (staff testing their own card) without the two overwriting each other.
 */

import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const CUSTOMER_COOKIE = "loyalty_customer";
const STAFF_COOKIE = "loyalty_staff";
const CUSTOMER_DAYS = 90; // long — the card should not ask them to sign in again
const STAFF_HOURS = 12; // one shift

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters");
  }
  return new TextEncoder().encode(value);
}

async function sign(payload, expiresIn) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(secret());
}

async function read(cookieName) {
  const store = await cookies();
  const token = store.get(cookieName)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return payload;
  } catch {
    return null; // expired or tampered
  }
}

const baseCookie = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

// ------------------------------------------------------------------ customer

export async function setCustomerSession(customerId) {
  const token = await sign({ sub: customerId, kind: "customer" }, `${CUSTOMER_DAYS}d`);
  const store = await cookies();
  store.set(CUSTOMER_COOKIE, token, { ...baseCookie, maxAge: CUSTOMER_DAYS * 86400 });
}

export async function getCustomerId() {
  const payload = await read(CUSTOMER_COOKIE);
  return payload?.kind === "customer" ? payload.sub : null;
}

export async function clearCustomerSession() {
  const store = await cookies();
  store.delete(CUSTOMER_COOKIE);
}

// --------------------------------------------------------------------- staff

export async function setStaffSession(staff) {
  const token = await sign(
    { sub: staff.id, kind: "staff", role: staff.role, branchId: staff.branchId ?? null },
    `${STAFF_HOURS}h`
  );
  const store = await cookies();
  store.set(STAFF_COOKIE, token, { ...baseCookie, maxAge: STAFF_HOURS * 3600 });
}

/** @returns {Promise<{id,role,branchId}|null>} */
export async function getStaffSession() {
  const payload = await read(STAFF_COOKIE);
  if (payload?.kind !== "staff") return null;
  return { id: payload.sub, role: payload.role, branchId: payload.branchId ?? null };
}

export async function clearStaffSession() {
  const store = await cookies();
  store.delete(STAFF_COOKIE);
}

// --------------------------------------------------------------- permissions

/** Admins have no branch of their own, which is what gives them all of them. */
export function canAccessAllBranches(role) {
  return role === "SUPER_ADMIN" || role === "COMPANY_ADMIN";
}

export function canAccessBranch(session, branchId) {
  if (!session) return false;
  if (canAccessAllBranches(session.role)) return true;
  return session.branchId === branchId;
}
