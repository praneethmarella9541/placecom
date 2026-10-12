#!/usr/bin/env node
/**
 * One-off backfill: encrypt Google tokens already stored in plaintext in
 * public.google_mailbox_credentials (AES-256-GCM, same format as lib/token-crypto.ts).
 * Safe to re-run — rows that are already encrypted are skipped.
 *
 * Usage (set the env of the target environment first):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... GOOGLE_TOKEN_ENCRYPTION_KEY=... \
 *     node scripts/encrypt-google-tokens.mjs [--dry-run]
 */
import { createClient } from "@supabase/supabase-js";
import { createCipheriv, randomBytes } from "node:crypto";

const PREFIX = "enc:v1:";
const dry = process.argv.includes("--dry-run");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const svcKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const keyB64 = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY;
if (!url || !svcKey || !keyB64) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and GOOGLE_TOKEN_ENCRYPTION_KEY");
  process.exit(1);
}
const key = Buffer.from(keyB64, "base64");
if (key.length !== 32) {
  console.error("GOOGLE_TOKEN_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  process.exit(1);
}

function enc(plain) {
  if (!plain || plain.startsWith(PREFIX)) return plain;
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${PREFIX}${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${ct.toString("base64url")}`;
}

const svc = createClient(url, svcKey, { auth: { persistSession: false } });
const { data, error } = await svc.from("google_mailbox_credentials").select("owner_user_id, refresh_token, access_token");
if (error) {
  console.error(error.message);
  process.exit(1);
}
let changed = 0;
for (const row of data ?? []) {
  const refresh = enc(row.refresh_token);
  const access = enc(row.access_token);
  if (refresh === row.refresh_token && access === row.access_token) continue;
  changed++;
  if (dry) continue;
  const { error: upErr } = await svc
    .from("google_mailbox_credentials")
    .update({ refresh_token: refresh, access_token: access })
    .eq("owner_user_id", row.owner_user_id);
  if (upErr) {
    console.error(`row ${row.owner_user_id}: ${upErr.message}`);
    process.exit(1);
  }
}
console.log(`${dry ? "[dry run] would encrypt" : "encrypted"} ${changed} of ${data?.length ?? 0} rows`);
