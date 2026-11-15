#!/usr/bin/env node
/**
 * Rotate GOOGLE_TOKEN_ENCRYPTION_KEY: decrypt every stored credential with the OLD key and
 * re-encrypt it with the NEW key (AES-256-GCM, same "enc:v1:" format as lib/token-crypto.ts).
 *
 * Covers every encrypted column the app writes:
 *   google_mailbox_credentials.refresh_token / access_token
 *   integration_connections.api_key_encrypted
 *
 * Safe order:
 *   1. Run with --dry-run: it decrypts every row with the OLD key and reports what it would change.
 *      It writes nothing and exits non-zero if any row cannot be decrypted.
 *   2. Run for real. Each row is checked to decrypt with the NEW key before it is written back,
 *      and a row that is already under the NEW key is skipped, so a half-finished run can be re-run.
 *   3. Only after it reports every row done, set GOOGLE_TOKEN_ENCRYPTION_KEY to the NEW key on the
 *      host and redeploy. Between steps 2 and 3 the running app still holds the OLD key, so do this
 *      in a quiet window (mailbox calls fail to decrypt until the redeploy is live).
 *   4. Retire the OLD key.
 *
 * Usage (target environment's values):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   GOOGLE_TOKEN_ENCRYPTION_KEY_OLD=<current key> GOOGLE_TOKEN_ENCRYPTION_KEY_NEW=<new key> \
 *     node scripts/rotate-google-token-key.mjs [--dry-run]
 *
 * Generate a new key with: openssl rand -base64 32
 */
import { createClient } from "@supabase/supabase-js";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const dry = process.argv.includes("--dry-run");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function loadKey(name) {
  const raw = process.env[name]?.trim();
  if (!raw) {
    console.error(`Need ${name}`);
    process.exit(1);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    console.error(`${name} must be 32 bytes, base64-encoded`);
    process.exit(1);
  }
  return key;
}

if (!url || !svcKey) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}
const oldKey = loadKey("GOOGLE_TOKEN_ENCRYPTION_KEY_OLD");
const newKey = loadKey("GOOGLE_TOKEN_ENCRYPTION_KEY_NEW");
if (oldKey.equals(newKey)) {
  console.error("OLD and NEW keys are the same; nothing to rotate");
  process.exit(1);
}

function decryptWith(key, stored) {
  const [iv, tag, ct] = stored.slice(PREFIX.length).split(".");
  if (!iv || !tag || !ct) throw new Error("malformed");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

function encryptWith(key, plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

/**
 * The value to store for one cell: null when it needs no change.
 * Throws if the cell is encrypted under neither key.
 */
function rotateCell(stored) {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) {
    throw new Error("stored in plaintext; run scripts/encrypt-google-tokens.mjs first");
  }
  try {
    decryptWith(newKey, stored);
    return null; // already under the NEW key
  } catch {
    /* not under the NEW key — expected for a row still to rotate */
  }
  const plain = decryptWith(oldKey, stored); // throws if it is under neither key
  const rotated = encryptWith(newKey, plain);
  if (decryptWith(newKey, rotated) !== plain) throw new Error("round-trip check failed");
  return rotated;
}

const TARGETS = [
  { table: "google_mailbox_credentials", id: "owner_user_id", columns: ["refresh_token", "access_token"] },
  { table: "integration_connections", id: "id", columns: ["api_key_encrypted"] },
];

const svc = createClient(url, svcKey, { auth: { persistSession: false } });
let failed = 0;
let changed = 0;
let total = 0;

for (const { table, id, columns } of TARGETS) {
  const { data, error } = await svc.from(table).select([id, ...columns].join(", "));
  if (error) {
    console.error(`${table}: ${error.message}`);
    process.exit(1);
  }
  for (const row of data ?? []) {
    total++;
    const patch = {};
    try {
      for (const col of columns) {
        const next = rotateCell(row[col]);
        if (next !== null) patch[col] = next;
      }
    } catch (e) {
      failed++;
      console.error(`${table} ${row[id]}: ${e instanceof Error ? e.message : "failed"}`); // ids only — never values
      continue;
    }
    if (!Object.keys(patch).length) continue;
    changed++;
    if (dry) continue;
    const { error: upErr } = await svc.from(table).update(patch).eq(id, row[id]);
    if (upErr) {
      failed++;
      console.error(`${table} ${row[id]}: ${upErr.message}`);
    }
  }
}

console.log(`${dry ? "[dry run] would rotate" : "rotated"} ${changed} of ${total} rows; ${failed} failed`);
if (failed) process.exit(1);
