import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { CrmStage } from "@/lib/crm-stages-types";

export type { CrmStage };

export const CRM_STAGE_SELECT = "id, name, description, position, color, is_unsorted";

/**
 * Seeded on a team's first visit rather than shipped as an enum — an empty
 * board is a dead end, but these are ordinary rows the user can rename,
 * reorder or delete. The descriptions matter as much as the names: they are
 * what the classifier is given as the definition of each category, so they
 * read as "what puts a lead here", not as a restatement of the label.
 */
const DEFAULT_STAGES: Omit<CrmStage, "id">[] = [
  {
    name: "Unsorted",
    description:
      "Leads the classifier could not place confidently. Nothing is auto-assigned out of here.",
    position: 0,
    color: "#8C857B",
    is_unsorted: true,
  },
  {
    name: "No contact yet",
    description: "No meaningful mail or WhatsApp with them since the season started.",
    position: 1,
    color: "#94A3B8",
    is_unsorted: false,
  },
  {
    name: "Reached out",
    description:
      "We have contacted them but they have not replied, or replied only with an acknowledgement.",
    position: 2,
    color: "#2563EB",
    is_unsorted: false,
  },
  {
    name: "In conversation",
    description:
      "A genuine two-way thread is running — they are asking questions, sharing details, or negotiating.",
    position: 3,
    color: "#D97706",
    is_unsorted: false,
  },
  {
    name: "Committed",
    description:
      "They have agreed to something concrete — shared a requirement, confirmed a date, or accepted a proposal.",
    position: 4,
    color: "#166534",
    is_unsorted: false,
  },
  {
    name: "Closed / dropped",
    description: "They declined, went cold after being chased, or the opportunity is finished.",
    position: 5,
    color: "#DC2626",
    is_unsorted: false,
  },
];

/**
 * Every stage for a team, creating the starter set the first time a team's
 * board is opened. The insert is best-effort: two tabs racing on first load
 * both try to seed, and the loser hits the (mailbox_owner_id, lower(name))
 * unique index — in that case we just re-read rather than surfacing an error.
 */
export async function listOrSeedStages(
  supabase: SupabaseClient,
  mailboxOwnerId: string,
  userId: string
): Promise<{ stages: CrmStage[]; error?: string }> {
  const read = async () => {
    const { data, error } = await supabase
      .from("crm_stages")
      .select(CRM_STAGE_SELECT)
      .eq("mailbox_owner_id", mailboxOwnerId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    return { rows: (data ?? []) as CrmStage[], error: error?.message };
  };

  const first = await read();
  if (first.error) return { stages: [], error: first.error };
  if (first.rows.length > 0) return { stages: first.rows };

  const { error: insertError } = await supabase.from("crm_stages").insert(
    DEFAULT_STAGES.map((s) => ({
      ...s,
      mailbox_owner_id: mailboxOwnerId,
      created_by: userId,
    }))
  );

  const second = await read();
  if (second.rows.length > 0) return { stages: second.rows };
  return { stages: [], error: insertError?.message ?? second.error };
}
