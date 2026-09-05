import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_CONNECTION_STRENGTH_SETTINGS,
  type ConnectionStrengthSettings,
} from "@/lib/email-connection-strength";

// Column names keep their original "_90d" suffix (migration 0050) even
// though the volume window itself became configurable in 0052 — renaming an
// existing column on a table that already has real rows isn't worth the
// risk for what's just a label; good_window_days/weak_window_days (0052)
// are what actually make the window configurable now, not the column name.
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

export function fromRow(row: SettingsRow): ConnectionStrengthSettings {
  return {
    goodRecencyDays: row.good_recency_days,
    goodMinMessages: row.good_min_messages_90d,
    goodWindowDays: row.good_window_days,
    requireOutboundForGood: row.require_outbound_for_good,
    weakRecencyDays: row.weak_recency_days,
    weakMinMessages: row.weak_min_messages_90d,
    weakWindowDays: row.weak_window_days,
    requireOutboundForWeak: row.require_outbound_for_weak,
    treatCcOnlyAsNoCommunication: row.treat_cc_only_as_no_communication,
  };
}

export const SETTINGS_COLUMNS =
  "good_recency_days, good_min_messages_90d, good_window_days, require_outbound_for_good, weak_recency_days, weak_min_messages_90d, weak_window_days, require_outbound_for_weak, treat_cc_only_as_no_communication";

/**
 * The caller's personal connection-strength thresholds, falling back to the
 * built-in defaults if they've never set any (or the table doesn't exist yet
 * on an un-migrated DB) — never throws, so a settings hiccup never breaks the
 * Contacts page itself.
 */
export async function getConnectionStrengthSettings(
  supabase: SupabaseClient,
  userId: string
): Promise<ConnectionStrengthSettings> {
  try {
    const { data, error } = await supabase
      .from("user_connection_strength_settings")
      .select(SETTINGS_COLUMNS)
      .eq("user_id", userId)
      .maybeSingle();
    if (error || !data) return DEFAULT_CONNECTION_STRENGTH_SETTINGS;
    return fromRow(data as SettingsRow);
  } catch {
    return DEFAULT_CONNECTION_STRENGTH_SETTINGS;
  }
}
