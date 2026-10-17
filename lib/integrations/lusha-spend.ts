import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConnectionRow, noteSpend, recordCheck, type ConnectorSettings } from "@/lib/integrations/connections";
import { LushaError, type LushaUsage } from "@/lib/integrations/lusha";
import type { OrgContext } from "@/lib/org-context";
import { decryptToken } from "@/lib/token-crypto";

export type SpendReady = {
  ok: true;
  apiKey: string;
  usage: LushaUsage | null;
  settings: ConnectorSettings;
};
export type SpendBlocked = { ok: false; status: number; error: string; code?: string };

/** First instant of the current month (UTC) — the window a monthly cap counts over. */
export function startOfMonthIso(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Credits this person has spent on Lusha so far this month. */
export async function creditsSpentThisMonth(svc: SupabaseClient, ownerId: string, userId: string): Promise<number> {
  const { data } = await svc
    .from("contact_enrichments")
    .select("credits_charged")
    .eq("mailbox_owner_id", ownerId)
    .eq("requested_by", userId)
    .gte("created_at", startOfMonthIso())
    .limit(10_000);
  return ((data ?? []) as { credits_charged: number }[]).reduce((n, r) => n + (r.credits_charged || 0), 0);
}

/**
 * Everything that must be true before credits are spent: Lusha is connected and its key reads, the
 * account has enough left, and this person is inside their monthly cap. Refusing here — before any
 * call to Lusha — is what keeps a stray click or a big selection from emptying the pool.
 *
 * `estimate` is the most the action could cost. Admins are exempt from the per-person cap: it
 * exists to limit what staff can spend, and an admin can change it anyway.
 */
export async function prepareSpend(ctx: OrgContext, estimate: number): Promise<SpendReady | SpendBlocked> {
  const row = await getConnectionRow(ctx.svc, ctx.mailboxOwnerId, "lusha");
  if (!row || row.status !== "connected") {
    return {
      ok: false,
      status: 400,
      code: "not_connected",
      error:
        ctx.role === "admin"
          ? "Lusha isn't connected. Connect it under Connectors first."
          : "Lusha isn't connected for your workspace. Ask an admin to connect it under Connectors.",
    };
  }

  let apiKey: string | null;
  try {
    apiKey = decryptToken(row.api_key_encrypted);
  } catch {
    apiKey = null;
  }
  if (!apiKey) {
    return { ok: false, status: 500, code: "key_unreadable", error: "The stored Lusha key can't be read. An admin needs to connect Lusha again." };
  }

  const cap = row.settings?.perUserMonthlyCap;
  if (ctx.role !== "admin" && typeof cap === "number" && cap >= 0) {
    const spent = await creditsSpentThisMonth(ctx.svc, ctx.mailboxOwnerId, ctx.userId);
    if (spent + estimate > cap) {
      return {
        ok: false,
        status: 403,
        code: "cap_reached",
        error: `This could use up to ${estimate} credits, but you have ${Math.max(0, cap - spent)} of your ${cap} monthly Lusha credits left. Ask an admin to raise your limit.`,
      };
    }
  }

  const remaining = row.usage?.credits.remaining;
  if (typeof remaining === "number" && row.usage && row.usage.credits.total > 0 && estimate > remaining) {
    return {
      ok: false,
      status: 402,
      code: "no_credits",
      error: `This could use up to ${estimate} credits, but your Lusha account has ${remaining} left.`,
    };
  }

  return { ok: true, apiKey, usage: row.usage, settings: row.settings ?? {} };
}

export type EnrichmentLog = {
  ownerId: string;
  userId: string;
  contactId: string | null;
  kind: "reveal" | "search";
  outcome: "found" | "not_found" | "partial" | "error";
  creditsCharged: number;
  revealed: unknown;
};

/** Record a spend, and move the stored credit balance by it. Returns the log row's id. */
export async function logEnrichment(svc: SupabaseClient, log: EnrichmentLog): Promise<string | null> {
  const { data } = await svc
    .from("contact_enrichments")
    .insert({
      mailbox_owner_id: log.ownerId,
      requested_by: log.userId,
      provider: "lusha",
      contact_id: log.contactId,
      kind: log.kind,
      outcome: log.outcome,
      credits_charged: Math.max(0, Math.round(log.creditsCharged)),
      revealed: log.revealed ?? null,
    })
    .select("id")
    .maybeSingle();
  await noteSpend(svc, log.ownerId, "lusha", log.creditsCharged);
  return (data as { id: string } | null)?.id ?? null;
}

/**
 * A failed Lusha call as an API response. A key Lusha refuses is also recorded on the connection, so
 * the Connectors page shows "Needs attention" instead of the next person finding out by failing.
 */
export async function lushaFailure(ctx: OrgContext, e: unknown): Promise<NextResponse> {
  if (!(e instanceof LushaError)) {
    return NextResponse.json({ error: "Something went wrong talking to Lusha." }, { status: 502 });
  }
  if (e.code === "invalid_key" || e.code === "inactive") {
    await recordCheck(ctx.svc, ctx.mailboxOwnerId, "lusha", {
      status: e.code === "invalid_key" ? "invalid" : "inactive",
      error: e.message,
    });
    return NextResponse.json(
      { error: "Lusha stopped accepting the connected key. An admin needs to reconnect it under Connectors.", code: e.code },
      { status: 502 },
    );
  }
  const status = e.code === "no_credits" ? 402 : e.code === "rate_limited" ? 429 : e.code === "unavailable" ? 502 : 502;
  return NextResponse.json({ error: e.message, code: e.code }, { status });
}
