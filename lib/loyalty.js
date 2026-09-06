/**
 * The loyalty rules, in one place.
 *
 * Values come from the Setting table so they can be changed without a deploy;
 * the constants here are only the fallback if a setting has never been written.
 * The client still has to confirm the real numbers.
 */

import { prisma } from "./db.js";

export const DEFAULTS = {
  points_per_currency: "1", // 1 point per AED 1
  welcome_discount_percent: "10",
  points_expiry_days: "0", // 0 = never
  qr_token_ttl_seconds: "180",
  otp_ttl_seconds: "300",
  otp_max_attempts: "5",
  currency: "AED",
};

let cache = null;
let cachedAt = 0;
const CACHE_MS = 30_000;

export async function getSettings() {
  if (cache && Date.now() - cachedAt < CACHE_MS) return cache;

  const rows = await prisma.setting.findMany();
  const fromDb = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cache = { ...DEFAULTS, ...fromDb };
  cachedAt = Date.now();
  return cache;
}

export function clearSettingsCache() {
  cache = null;
}

export async function getSetting(key) {
  const s = await getSettings();
  return s[key];
}

export async function getNumber(key) {
  return Number(await getSetting(key));
}

/** Points for a bill. Floored — a partial point is not awarded. */
export async function pointsForAmount(amount) {
  const rate = await getNumber("points_per_currency");
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value * rate);
}

/**
 * Which rewards this customer has just become eligible for.
 *
 * Called after a transaction with the customer's new totals. Returns reward
 * definitions to issue; the caller decides whether they are already held, so
 * this stays a pure lookup.
 */
export async function newlyEligibleRewards({ pointsBalance, visitCount, alreadyHeldRewardIds = [] }) {
  const rewards = await prisma.reward.findMany({
    where: { isActive: true, type: { in: ["POINTS", "VISITS"] } },
  });

  return rewards.filter((r) => {
    if (alreadyHeldRewardIds.includes(r.id)) return false;
    if (r.type === "POINTS") return pointsBalance >= r.threshold;
    if (r.type === "VISITS") return visitCount > 0 && visitCount % r.threshold === 0;
    return false;
  });
}
