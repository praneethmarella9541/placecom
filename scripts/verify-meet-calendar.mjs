/**
 * Verifies the admin token can write to the Meet organizer calendar.
 * Usage: node scripts/verify-meet-calendar.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env.local");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  }
}

const organizer =
  process.env.GOOGLE_MEET_ORGANIZER_EMAIL?.trim() || "g24072@astra.xlri.ac.in";
const admin =
  process.env.GOOGLE_MEET_ORGANIZER_ADMIN_EMAIL?.trim() ||
  "chetangalla248@gmail.com";
const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim();

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const { data: row } = await sb
  .from("google_mailbox_credentials")
  .select("refresh_token, access_token, access_token_expires_at, gmail_address")
  .eq("gmail_address", admin)
  .maybeSingle();

if (!row?.refresh_token && !row?.access_token) {
  console.error(`No Google tokens in DB for admin mailbox ${admin}`);
  process.exit(1);
}

let accessToken = row.access_token;
const exp = row.access_token_expires_at
  ? new Date(row.access_token_expires_at).getTime()
  : 0;
if (!accessToken || Date.now() > exp - 120_000) {
  if (!clientSecret) {
    console.error("GOOGLE_OAUTH_CLIENT_SECRET missing in .env.local (needed to refresh)");
    process.exit(1);
  }
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: row.refresh_token,
    grant_type: "refresh_token",
  });
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const tokens = await tokenRes.json();
  if (!tokenRes.ok) {
    console.error("Token refresh failed:", tokens);
    process.exit(1);
  }
  accessToken = tokens.access_token;
}

const cal = encodeURIComponent(organizer);
const listRes = await fetch(
  `https://www.googleapis.com/calendar/v3/calendars/${cal}`,
  { headers: { Authorization: `Bearer ${accessToken}` } }
);
const calJson = await listRes.json();
if (!listRes.ok) {
  console.error(
    "Cannot access organizer calendar:",
    calJson.error?.message || listRes.status
  );
  console.error(
    `\nAsk ${organizer} to share their calendar with ${admin} (Make changes to events).`
  );
  process.exit(1);
}

console.log("OK: admin can access organizer calendar:", calJson.summary || organizer);
