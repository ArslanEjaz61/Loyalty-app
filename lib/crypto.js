import { randomBytes, scrypt as _scrypt, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt);

/** Hashes a PIN or OTP with a per-value salt. Returns "salt:hash". */
export async function hashSecret(secret) {
  const salt = randomBytes(16).toString("hex");
  const derived = await scrypt(String(secret), salt, 32);
  return `${salt}:${derived.toString("hex")}`;
}

/** Constant-time check so a wrong PIN cannot be found by timing the response. */
export async function verifySecret(secret, stored) {
  if (!stored || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const derived = await scrypt(String(secret), salt, 32);
  const known = Buffer.from(hash, "hex");
  if (known.length !== derived.length) return false;
  return timingSafeEqual(known, derived);
}

/** URL-safe random string, used for session ids. */
export function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

// No 0/O/1/I/L so a cashier reading the code off a customer's phone cannot
// mistype it. 32 symbols, 8 characters -> ~1.1 trillion combinations, which is
// ample for a code that also expires after a minute and is single use.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/**
 * The value inside the QR. Deliberately short enough to type by hand, because
 * the camera is not always available — iOS Safari has no BarcodeDetector, tills
 * have broken cameras, and the demo must not dead-end when that happens.
 */
export function randomCode(length = 8) {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/** Accepts "k7m2-9xpq", "K7M2 9XPQ" or "K7M29XPQ" and returns "K7M29XPQ". */
export function normalizeCode(input) {
  return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Splits into two groups so it reads aloud cleanly: "K7M2 · 9XPQ". */
export function formatCode(code) {
  const c = normalizeCode(code);
  if (c.length !== 8) return c;
  return `${c.slice(0, 4)} ${c.slice(4)}`;
}

/** Six digits, zero-padded. Uniform enough for a one-time code. */
export function randomOtp() {
  return String(randomBytes(4).readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

export function sha256(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
