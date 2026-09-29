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
    .select("campaign_id, campaign_name, sent_at, opened")
    .eq("user_id", user.id)
    .not("campaign_id", "is", null)
    .order("sent_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byId = new Map<string, CampaignListItem>();
  for (const row of (data ?? []) as { campaign_id: string; campaign_name: string | null; sent_at: string; opened: boolean }[]) {
    const existing = byId.get(row.campaign_id);
    if (!existing) {
      byId.set(row.campaign_id, {
        campaignId: row.campaign_id,
        campaignName: row.campaign_name || "Untitled campaign",
        sentCount: 1,
        openedCount: row.opened ? 1 : 0,
        firstSentAt: row.sent_at,
      });
      continue;
    }
    existing.sentCount += 1;
    if (row.opened) existing.openedCount += 1;
    if (row.sent_at < existing.firstSentAt) existing.firstSentAt = row.sent_at;
  }

  const campaigns = Array.from(byId.values()).sort((a, b) => b.firstSentAt.localeCompare(a.firstSentAt));
  return NextResponse.json({ campaigns });
}
