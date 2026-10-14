import { NextResponse } from "next/server";

import { assertAdminUserId } from "@/lib/admin-auth";
import {
  getConnectionRow,
  getPublicConnection,
  recordCheck,
  removeConnection,
  saveConnection,
} from "@/lib/integrations/connections";
import { LushaError, fetchLushaUsage } from "@/lib/integrations/lusha";
import { createServiceSupabase } from "@/lib/supabase-service";
import { decryptToken, isTokenEncryptionConfigured } from "@/lib/token-crypto";

export const runtime = "nodejs";

/** Lusha allows 5 usage calls a minute, so a refresh inside this window just returns what we have. */
const MIN_REFRESH_MS = 15_000;

function lushaProblem(e: LushaError) {
  const status =
    e.code === "rate_limited" ? 429 : e.code === "unavailable" ? 502 : e.code === "unexpected" ? 502 : 400;
  return NextResponse.json({ error: e.message, code: e.code }, { status });
}

/** GET /api/integrations/lusha[?refresh=1] — this account's Lusha connection, with credits. Admin only. */
export async function GET(request: Request) {
  const admin = await assertAdminUserId(request);
  if ("error" in admin) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const svc = createServiceSupabase();

  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  const row = await getConnectionRow(svc, admin.userId, "lusha");
  if (!row) return NextResponse.json({ connection: await getPublicConnection(svc, admin.userId, "lusha") });

  const lastChecked = row.last_checked_at ? Date.parse(row.last_checked_at) : 0;
  if (refresh && Date.now() - lastChecked > MIN_REFRESH_MS) {
    try {
      const usage = await fetchLushaUsage(decryptToken(row.api_key_encrypted) ?? "");
      await recordCheck(svc, admin.userId, "lusha", { usage });
    } catch (e) {
      if (e instanceof LushaError && (e.code === "invalid_key" || e.code === "inactive")) {
        await recordCheck(svc, admin.userId, "lusha", {
          status: e.code === "invalid_key" ? "invalid" : "inactive",
          error: e.message,
        });
      } else if (!(e instanceof LushaError)) {
        // An undecryptable key (the encryption key changed) is surfaced as an invalid connection.
        await recordCheck(svc, admin.userId, "lusha", {
          status: "invalid",
          error: "The stored key could not be read. Connect Lusha again.",
        });
      }
      // Rate limiting or an outage leaves the last good snapshot in place.
    }
  }

  return NextResponse.json({ connection: await getPublicConnection(svc, admin.userId, "lusha") });
}

/** PUT /api/integrations/lusha { apiKey } — connect, or replace the key. Admin only. */
export async function PUT(request: Request) {
  const admin = await assertAdminUserId(request);
  if ("error" in admin) return NextResponse.json({ error: admin.error }, { status: admin.status });

  const body = (await request.json().catch(() => ({}))) as { apiKey?: unknown };
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  if (apiKey.length < 8 || apiKey.length > 200 || /\s/.test(apiKey)) {
    return NextResponse.json({ error: "That doesn't look like a Lusha API key." }, { status: 400 });
  }
  if (!isTokenEncryptionConfigured()) {
    // Never fall back to storing a customer's key in the clear.
    return NextResponse.json(
      { error: "This server has no encryption key configured, so it can't store an API key safely." },
      { status: 500 },
    );
  }

  // Proving the key works also fetches the credit balance, and costs no credits.
  let usage;
  try {
    usage = await fetchLushaUsage(apiKey);
  } catch (e) {
    if (e instanceof LushaError) return lushaProblem(e);
    return NextResponse.json({ error: "Could not check that key with Lusha." }, { status: 502 });
  }

  try {
    const connection = await saveConnection(createServiceSupabase(), {
      ownerId: admin.userId,
      userId: admin.userId,
      provider: "lusha",
      apiKey,
      usage,
    });
    return NextResponse.json({ connection });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not save the connection." },
      { status: 500 },
    );
  }
}

/** DELETE /api/integrations/lusha — forget the key. Admin only. */
export async function DELETE(request: Request) {
  const admin = await assertAdminUserId(request);
  if ("error" in admin) return NextResponse.json({ error: admin.error }, { status: admin.status });
  await removeConnection(createServiceSupabase(), admin.userId, "lusha");
  return NextResponse.json({ ok: true });
}
