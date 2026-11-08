import { createHash } from "node:crypto";

/**
 * Password policy for every place the application sets a password (CASA 1.1.1, control 2.4):
 *   - at least MIN_LENGTH characters (the same 8 the sign-in forms already ask for),
 *   - not a very common password, and
 *   - not a password that appears in a known data breach.
 *
 * The breach check uses the free Have I Been Pwned "Pwned Passwords" range API with k-anonymity:
 * only the first 5 hex characters of the password's SHA-1 are sent, never the password or its full
 * hash, and the response is padded so its size reveals nothing. SHA-1 is used here only because that
 * service's lookup protocol is defined on it; it protects nothing and no stored data is hashed with it.
 *
 * If the breach service can't be reached within the timeout the breach check is skipped (the length
 * and common-password rules still apply) and a warning is logged, so a third-party outage can't stop
 * people from setting a password.
 */

export const MIN_LENGTH = 8;
export const WEAK_PASSWORD_MESSAGE = "That password is too common. Choose a different one.";
export const BREACHED_PASSWORD_MESSAGE =
  "That password has appeared in a known data breach. Choose a different one.";

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";
const HIBP_TIMEOUT_MS = 3000;

const COMMON = new Set(
  (
    "password password1 password12 password123 password1234 passw0rd p@ssw0rd p@ssword 12345678 123456789 1234567890 " +
    "11111111 00000000 123123123 12341234 qwertyui qwerty123 qwertyuiop 1q2w3e4r 1q2w3e4r5t 1qaz2wsx qazwsxedc " +
    "iloveyou welcome1 welcome123 admin123 administrator letmein1 letmein123 abc12345 abcd1234 abcdefgh monkey123 " +
    "football1 baseball1 dragon123 master123 sunshine1 princess1 superman1 trustno1 changeme changeme1 default123 " +
    "india123 india@123 password@123 welcome@123 admin@123 test1234 test@123 user1234 nucleus123 thenucleus"
  ).split(" ")
);

export type PasswordCheck = { ok: true } | { ok: false; error: string };

async function isBreached(password: string): Promise<boolean> {
  const sha1 = createHash("sha1").update(password, "utf8").digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(HIBP_RANGE_URL + prefix, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(HIBP_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.text();
    for (const line of body.split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix === suffix && Number(count) > 0) return true;
    }
    return false;
  } catch {
    console.warn("[password-policy] breach check unavailable; applied length and common-password rules only");
    return false;
  }
}

export async function checkPasswordPolicy(password: string): Promise<PasswordCheck> {
  if (password.length < MIN_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_LENGTH} characters.` };
  }
  if (COMMON.has(password.toLowerCase()) || /^(.)\1+$/.test(password)) {
    return { ok: false, error: WEAK_PASSWORD_MESSAGE };
  }
  if (await isBreached(password)) {
    return { ok: false, error: BREACHED_PASSWORD_MESSAGE };
  }
  return { ok: true };
}
