/**
 * SMS delivery for one-time codes.
 *
 * No provider is connected yet — the client still has to choose one and say who
 * pays per message. Until then SMS_PROVIDER stays "console": the code is logged
 * and, in development only, returned to the browser so the flow is testable end
 * to end. Adding a real provider is one case in the switch below; nothing that
 * calls sendOtp() changes.
 */

const PROVIDER = process.env.SMS_PROVIDER || "console";

export function isDevDelivery() {
  return PROVIDER === "console";
}

/**
 * @returns {Promise<{ delivered: boolean, provider: string }>}
 * Throws only on a real provider failure, so registration can report it.
 */
export async function sendOtp(mobile, code) {
  switch (PROVIDER) {
    case "console": {
      console.log(`[sms:console] OTP for ${mobile} is ${code}`);
      return { delivered: true, provider: "console" };
    }

    // Example of what a real provider looks like. Left unreachable until the
    // client picks one and supplies credentials.
    case "http": {
      const url = process.env.SMS_HTTP_URL;
      const key = process.env.SMS_HTTP_KEY;
      const sender = process.env.SMS_SENDER_ID || "Loyalty";
      if (!url || !key) throw new Error("SMS_HTTP_URL and SMS_HTTP_KEY must be set");

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          to: mobile,
          sender,
          message: `${code} is your verification code.`,
        }),
      });
      if (!res.ok) {
        throw new Error(`SMS provider returned ${res.status}: ${(await res.text()).slice(0, 200)}`);
      }
      return { delivered: true, provider: "http" };
    }

    default:
      throw new Error(`Unknown SMS_PROVIDER: ${PROVIDER}`);
  }
}
