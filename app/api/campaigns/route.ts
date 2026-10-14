import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";

export const runtime = "nodejs";

export type CampaignListItem = {
  campaignId: string;
  campaignName: string;
  sentCount: number;
  openedCount: number;
  firstSentAt: string;
};

/**
 * GET /api/campaigns — one row per mass/mail-merge send, newest first.
 *
 * A "campaign" isn't its own table — it's just the shared campaign_id every
 * recipient of one Send click gets stamped with (see app/api/gmail/send).
 * Rolling email_tracking up by that id is enough to list them; the per-
 * campaign report (replied/bounced) lives in [campaignId]/route.ts since that
 * needs a live Gmail check, not just a read.
 */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("email_tracking")
    .select("campaign_id, campaign_name, sent_at, opened, to_address")
    .eq("user_id", user.id)
    .not("campaign_id", "is", null)
    .order("sent_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Counted per person: a flow scheduled with follow-ups has several rows for each recipient.
  type Row = { campaign_id: string; campaign_name: string | null; sent_at: string; opened: boolean; to_address: string };
  const byId = new Map<string, CampaignListItem>();
  const recipientsByCampaign = new Map<string, Map<string, boolean>>();
  for (const row of (data ?? []) as Row[]) {
    const recipient = row.to_address.trim().toLowerCase();
    let people = recipientsByCampaign.get(row.campaign_id);
    if (!people) {
      people = new Map();
      recipientsByCampaign.set(row.campaign_id, people);
    }
    people.set(recipient, (people.get(recipient) ?? false) || row.opened);

    const existing = byId.get(row.campaign_id);
    if (!existing) {
      byId.set(row.campaign_id, {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name || "Untitled campaign",
        sentCount: 0,
        openedCount: 0,
        firstSentAt: row.sent_at,
      });
      continue;
    }
    if (row.sent_at < existing.firstSentAt) existing.firstSentAt = row.sent_at;
  }
  for (const [id, people] of Array.from(recipientsByCampaign.entries())) {
    const item = byId.get(id);
    if (!item) continue;
    item.sentCount = people.size;
    item.openedCount = Array.from(people.values()).filter(Boolean).length;
  }

  const campaigns = Array.from(byId.values()).sort((a, b) => b.firstSentAt.localeCompare(a.firstSentAt));
  return NextResponse.json({ campaigns });
}
