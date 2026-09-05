import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import {
  DEFAULT_CONNECTION_STRENGTH_SETTINGS,
  type ConnectionStrengthSettings,
} from "@/lib/email-connection-strength";
import { fromRow, SETTINGS_COLUMNS } from "@/lib/connection-strength-settings";

export const runtime = "nodejs";

type SettingsRow = {
  good_recency_days: number;
  good_min_messages_90d: number;
  good_window_days: number;
  require_outbound_for_good: boolean;
  weak_recency_days: number;
  weak_min_messages_90d: number;
  weak_window_days: number;
  require_outbound_for_weak: boolean;
  treat_cc_only_as_no_communication: boolean;
};

function toResponse(row: SettingsRow | null): { settings: ConnectionStrengthSettings; isDefault: boolean } {
  if (!row) return { settings: DEFAULT_CONNECTION_STRENGTH_SETTINGS, isDefault: true };
  return { settings: fromRow(row), isDefault: false };
}

/** GET /api/user-settings/connection-strength — the caller's own thresholds, or the built-in defaults. */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("user_connection_strength_settings")
    .select(SETTINGS_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    if (/relation.*user_connection_strength_settings.*does not exist/i.test(error.message ?? "")) {
      return NextResponse.json(toResponse(null));
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(toResponse((data as SettingsRow | null) ?? null));
}

type PatchBody = Partial<{
  goodRecencyDays: number;
  goodMinMessages: number;
  goodWindowDays: number;
  requireOutboundForGood: boolean;
  weakRecencyDays: number;
  weakMinMessages: number;
  weakWindowDays: number;
  requireOutboundForWeak: boolean;
  treatCcOnlyAsNoCommunication: boolean;
}>;

function validate(
  body: PatchBody,
  base: ConnectionStrengthSettings
): { ok: true; clean: SettingsRow } | { ok: false; error: string } {
  const merged: ConnectionStrengthSettings = {
    goodRecencyDays: body.goodRecencyDays ?? base.goodRecencyDays,
    goodMinMessages: body.goodMinMessages ?? base.goodMinMessages,
    goodWindowDays: body.goodWindowDays ?? base.goodWindowDays,
    requireOutboundForGood: body.requireOutboundForGood ?? base.requireOutboundForGood,
    weakRecencyDays: body.weakRecencyDays ?? base.weakRecencyDays,
    weakMinMessages: body.weakMinMessages ?? base.weakMinMessages,
    weakWindowDays: body.weakWindowDays ?? base.weakWindowDays,
    requireOutboundForWeak: body.requireOutboundForWeak ?? base.requireOutboundForWeak,
    treatCcOnlyAsNoCommunication: body.treatCcOnlyAsNoCommunication ?? base.treatCcOnlyAsNoCommunication,
  };

  if (!Number.isInteger(merged.goodRecencyDays) || merged.goodRecencyDays <= 0) {
    return { ok: false, error: "\"Good\" recency must be a positive whole number of days" };
  }
  if (!Number.isInteger(merged.goodMinMessages) || merged.goodMinMessages <= 0) {
    return { ok: false, error: "\"Good\" minimum message count must be a positive whole number" };
  }
  if (!Number.isInteger(merged.goodWindowDays) || merged.goodWindowDays <= 0) {
    return { ok: false, error: "\"Good\" message window must be a positive whole number of days" };
  }
  if (!Number.isInteger(merged.weakMinMessages) || merged.weakMinMessages <= 0) {
    return { ok: false, error: "\"Weak\" minimum message count must be a positive whole number" };
  }
  if (!Number.isInteger(merged.weakWindowDays) || merged.weakWindowDays <= 0) {
    return { ok: false, error: "\"Weak\" message window must be a positive whole number of days" };
  }
  if (!Number.isInteger(merged.weakRecencyDays) || merged.weakRecencyDays < merged.goodRecencyDays) {
    return { ok: false, error: "\"Weak\" recency must be a whole number of days, at least the \"Good\" recency" };
  }

  return {
    ok: true,
    clean: {
      good_recency_days: merged.goodRecencyDays,
      good_min_messages_90d: merged.goodMinMessages,
      good_window_days: merged.goodWindowDays,
      require_outbound_for_good: merged.requireOutboundForGood,
      weak_recency_days: merged.weakRecencyDays,
      weak_min_messages_90d: merged.weakMinMessages,
      weak_window_days: merged.weakWindowDays,
      require_outbound_for_weak: merged.requireOutboundForWeak,
      treat_cc_only_as_no_communication: merged.treatCcOnlyAsNoCommunication,
    },
  };
}

/** PATCH /api/user-settings/connection-strength — upsert the caller's thresholds (partial; merges with current/default values). */
export async function PATCH(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as PatchBody | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const { data: existing } = await supabase
    .from("user_connection_strength_settings")
    .select(SETTINGS_COLUMNS)
    .eq("user_id", user.id)
    .maybeSingle();
  const base = toResponse((existing as SettingsRow | null) ?? null).settings;

  const validated = validate(body, base);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const { data, error } = await supabase
    .from("user_connection_strength_settings")
    .upsert({ user_id: user.id, ...validated.clean, updated_at: new Date().toISOString() }, { onConflict: "user_id" })
    .select(SETTINGS_COLUMNS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(toResponse(data as SettingsRow));
}

/** DELETE /api/user-settings/connection-strength — reset to the built-in defaults. */
export async function DELETE(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("user_connection_strength_settings").delete().eq("user_id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(toResponse(null));
}
