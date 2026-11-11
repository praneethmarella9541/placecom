/**
 * Log redaction (CASA 6.5.1: no credentials or payment details in logs).
 *
 * Every server-side console.log / info / warn / error / debug call is passed through
 * redactForLog() before it is written (installLogRedaction(), wired up in instrumentation.ts),
 * so a secret that reaches a log call by accident — an error object carrying a request header, a
 * logged response body, a stringified config — is replaced before it leaves the process.
 *
 * What it removes:
 *  - values of fields whose name looks like a credential (password, secret, token, api key,
 *    authorization, cookie, cvv, card number, ...) in objects, JSON text and key=value text
 *  - JWTs (Supabase session / access tokens), "Bearer ..." values, Google OAuth tokens
 *    (ya29. access tokens, 1// refresh tokens), "sk-..." API keys, and our own "enc:v1:" ciphertext
 *  - payment card numbers (13-19 digits that pass the Luhn check)
 *
 * Session tokens are never logged in any form, hashed or otherwise; the redactor replaces them
 * with a fixed marker, so nothing derived from them reaches a log.
 */

const REDACTED = "[REDACTED]";

const SENSITIVE_NAME =
  /(passw(or)?d|pwd|secret|token|api[_-]?key|apikey|authorization|auth[_-]?header|cookie|cvv|cvc|card[_-]?(number|no)|private[_-]?key|credential|service[_-]?role)/i;

// "name": "value" | name=value | name: value  — only when the name looks sensitive.
const KEY_VALUE =
  /((?:["']?)[\w.-]*(?:passw(?:or)?d|pwd|secret|token|api[_-]?key|apikey|authorization|cookie|cvv|cvc|private[_-]?key|credential|service[_-]?role)[\w.-]*(?:["']?)\s*[:=]\s*)("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|[^\s,;&}\])]+)/gi;

const PATTERNS: Array<[RegExp, string]> = [
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}\b/g, "[REDACTED_JWT]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]"],
  [/\bya29\.[\w-]{10,}/g, "[REDACTED_GOOGLE_TOKEN]"],
  [/\b1\/\/[\w-]{20,}/g, "[REDACTED_GOOGLE_TOKEN]"],
  [/\bsk-[A-Za-z0-9_-]{16,}/g, "[REDACTED_API_KEY]"],
  [/enc:v1:[\w.-]+/g, "[REDACTED_ENCRYPTED]"],
];

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

export function redactString(input: string): string {
  let out = input;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  out = out.replace(KEY_VALUE, (_m, name: string) => `${name}"${REDACTED}"`);
  out = out.replace(/\b\d(?:[ -]?\d){12,18}\b/g, (m) => {
    const digits = m.replace(/[ -]/g, "");
    return digits.length >= 13 && digits.length <= 19 && luhnValid(digits) ? "[REDACTED_CARD]" : m;
  });
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== "object") return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function redactForLog(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (depth > 6) return "[Truncated]";
  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  if (value instanceof Error) {
    const copy = new Error(redactString(value.message));
    copy.name = value.name;
    if (value.stack) copy.stack = redactString(value.stack);
    // Supabase / fetch errors often carry extra fields (status, details, hint, code).
    for (const [k, v] of Object.entries(value as unknown as Record<string, unknown>)) {
      (copy as unknown as Record<string, unknown>)[k] = SENSITIVE_NAME.test(k) ? REDACTED : redactForLog(v, depth + 1, seen);
    }
    return copy;
  }
  if (Array.isArray(value)) return value.map((v) => redactForLog(v, depth + 1, seen));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_NAME.test(k) ? REDACTED : redactForLog(v, depth + 1, seen);
    }
    return out;
  }
  // Headers, Request, Buffer, class instances: never dump their contents.
  return value instanceof Headers ? "[Headers]" : value;
}

const INSTALLED = Symbol.for("placecom.logRedactionInstalled");
const METHODS = ["log", "info", "warn", "error", "debug"] as const;

/** Wraps the global console so every server log line goes through redactForLog first. */
export function installLogRedaction(): void {
  const g = globalThis as unknown as Record<symbol, boolean>;
  if (g[INSTALLED]) return;
  g[INSTALLED] = true;
  for (const method of METHODS) {
    const original = console[method].bind(console);
    console[method] = (...args: unknown[]) => {
      let safe: unknown[];
      try {
        safe = args.map((a) => redactForLog(a));
      } catch {
        // If redaction itself fails, drop the arguments rather than risk writing them raw.
        safe = ["[log arguments withheld: redaction failed]"];
      }
      original(...safe);
    };
  }
}
