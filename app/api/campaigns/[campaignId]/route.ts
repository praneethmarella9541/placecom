import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";

export const runtime = "nodejs";

type TrackingRow = {
  to_address: string;
  sent_at: string;
  opened: boolean;
  opened_at: string | null;
  replied: boolean;
  bounced: boolean;
};

export type CampaignRecipient = {
  email: string;
  sentAt: string;
  opened: boolean;
  openedAt: string | null;
  replied: boolean;
  bounced: boolean;
};

export type CampaignReport = {
  campaignId: string;
  campaignName: string;
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  recipients: CampaignRecipient[];
};

/**
 * GET /api/campaigns/[campaignId] — Sent/Opened/Responded/Bounced for one
 * mass send.
 *
 * A pure read — no Gmail calls happen here. This used to actively check each
 * pending recipient's thread (and search for a bounce) on every view, which
 * spent real Gmail quota just to answer a UI question. replied/bounced are
 * now kept current passively, piggybacked onto threads the app opens anyway —
 * see lib/tracking-passive-sync.ts for the full reasoning and
 * app/api/gmail/threads/[id]/route.ts for where that happens. That means
 * status here is "as of the last time the relevant thread was opened," not
 * instantly live — refreshing this page alone won't resolve anything new;
 * opening the reply or the bounce notice in the inbox will.
 */
export async function GET(request: Request, { params }: { params: { campaignId: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: rows, error } = await supabase
    .from("email_tracking")
    .select("to_address, sent_at, opened, opened_at, replied, bounced, campaign_name")
    .eq("user_id", user.id)
    .eq("campaign_id", params.campaignId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const campaignName = (rows[0] as { campaign_name: string | null }).campaign_name || "Untitled campaign";
  const trackingRows = rows as (TrackingRow & { campaign_name: string | null })[];

  const report: CampaignReport = {
    campaignId: params.campaignId,
    campaignName,
    sent: trackingRows.length,
    opened: trackingRows.filter((r) => r.opened).length,
    replied: trackingRows.filter((r) => r.replied).length,
    bounced: trackingRows.filter((r) => r.bounced).length,
    recipients: trackingRows
      .map((r) => ({
        email: r.to_address,
        sentAt: r.sent_at,
        opened: r.opened,
        openedAt: r.opened_at,
        replied: r.replied,
        bounced: r.bounced,
      }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  };

  return NextResponse.json({ report });
}
