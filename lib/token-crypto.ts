import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Application-level encryption for Google OAuth tokens stored in
 * google_mailbox_credentials (AES-256-GCM, key from GOOGLE_TOKEN_ENCRYPTION_KEY).
 *
 * Stored format: "enc:v1:<iv>.<authTag>.<ciphertext>" (all base64url).
 *
 * Rollout-safe by design:
 *  - decryptToken passes plaintext (legacy rows, no "enc:v1:" prefix) through unchanged,
 *    so existing rows keep working until the backfill script has encrypted them.
 *  - encryptToken is idempotent: an already-encrypted value is returned as-is, so code
 *    that copies a stored value back into an upsert never double-encrypts.
 *  - If no key is configured, encryptToken stores plaintext (and warns once) rather than
 *    taking the mailbox down — but never in production (VERCEL_ENV=production), where a missing
 *    key throws so a misconfiguration can't quietly downgrade stored credentials to plaintext.
 *    decryptToken of an encrypted value without a key throws.
 *
 * Key lifecycle: one 32-byte key per deployment, held only in the host's environment variables
 * (never in the repo or the database). Rotating it is a deliberate re-encryption of every stored
 * value: scripts/rotate-google-token-key.mjs.
 */

const PREFIX = "enc:v1:";
let warnedNoKey = false;

/**
 * Every way decryption can fail — no key, a malformed value, a failed authentication tag — ends
 * in this one error with a fixed message, so nothing about *why* it failed (wrong key, tampered,
 * truncated) reaches a caller, a response body or a log line (CASA 4.1.4).
 */
export class TokenDecryptError extends Error {
  constructor() {
    super("Stored credential could not be decrypted");
    this.name = "TokenDecryptError";
  }
}

function getKey(): Buffer | null {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded (openssl rand -base64 32)");
  }
  return key;
}

/**
 * True when a valid encryption key is configured. Google tokens tolerate its absence (they are
 * stored as-is with a warning rather than taking the mailbox down); a third-party API key a customer
 * pastes in should not be — callers that store one refuse instead of writing it in the clear.
 */
export function isTokenEncryptionConfigured(): boolean {
  try {
    return getKey() !== null;
  } catch {
    return false;
  }
}

export function isEncryptedToken(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function encryptToken(plain: string | null | undefined): string | null {
  if (plain == null || plain === "") return plain ?? null;
  if (isEncryptedToken(plain)) return plain;
  const key = getKey();
  if (!key) {
    if (process.env.VERCEL_ENV === "production") {
      throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY is required in production; refusing to store a credential unencrypted");
    }
    if (!warnedNoKey) {
      warnedNoKey = true;
      console.warn("[token-crypto] GOOGLE_TOKEN_ENCRYPTION_KEY is not set — storing Google tokens unencrypted");
    }
    return plain;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ct.toString("base64url")}`;
}

export function decryptToken(stored: string | null | undefined): string | null {
  if (stored == null || stored === "") return stored ?? null;
  if (!isEncryptedToken(stored)) return stored;
  try {
    const key = getKey();
    if (!key) throw new Error("no key");
    const [iv, tag, ct] = stored.slice(PREFIX.length).split(".");
    if (!iv || !tag || !ct) throw new Error("malformed");
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // One error for every cause (see TokenDecryptError): the reason stays out of responses and logs.
    throw new TokenDecryptError();
  }
}
