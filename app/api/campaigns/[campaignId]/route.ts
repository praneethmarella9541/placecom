import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { checkThreadForReplyOrBounce } from "@/lib/email-thread-outcome";

export const runtime = "nodejs";

type TrackingRow = {
  id: string;
  to_address: string;
  gmail_thread_id: string | null;
  sent_at: string;
  opened: boolean;
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
};

/**
 * GET /api/campaigns/[campaignId] — Sent/Opened/Responded/Bounced for one
 * mass send.
 *
 * Opened is already on the row (the tracking pixel keeps it current). Replied
 * and bounced are not written anywhere in real time — nothing polls a mail-
 * merge send the way lib/sequence-runner.ts's cron does for sequences — so
 * this checks each not-yet-resolved thread live, the same heuristic
 * (checkThreadForReplyOrBounce) sequences use, and writes the outcome back so
 * a settled thread is never re-checked. Bounded to rows still worth checking:
 * once a row is replied or bounced that's permanent, so the live-check cost
 * only ever applies to the actually-undecided remainder of a campaign.
 */
export async function GET(request: Request, { params }: { params: { campaignId: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: rows, error } = await supabase
    .from("email_tracking")
    .select("id, to_address, gmail_thread_id, sent_at, opened, replied, bounced, campaign_name")
    .eq("user_id", user.id)
    .eq("campaign_id", params.campaignId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const campaignName = (rows[0] as { campaign_name: string | null }).campaign_name || "Untitled campaign";
  const pending = (rows as (TrackingRow & { campaign_name: string | null })[]).filter(
    (r) => !r.replied && !r.bounced && r.gmail_thread_id
  );

  if (pending.length > 0) {
    const auth = await requireGmailAccessToken(request);
    if (auth.ok) {
      const results = await Promise.all(
        pending.map(async (row) => {
          const outcome = await checkThreadForReplyOrBounce(auth.accessToken, row.gmail_thread_id!, {
            mailboxAddress: auth.gmailAddress,
            firstSentAt: Date.parse(row.sent_at) || 0,
            mailboxKey: auth.mailboxOwnerId,
          }).catch(() => null);
          return { id: row.id, outcome };
        })
      );

      const now = new Date().toISOString();
      for (const { id, outcome } of results) {
        if (!outcome) continue;
        await supabase
          .from("email_tracking")
          .update(
            outcome === "replied"
              ? { replied: true, replied_at: now }
              : { bounced: true, bounced_at: now }
          )
          .eq("id", id);
        const row = pending.find((r) => r.id === id);
        if (row) {
          if (outcome === "replied") row.replied = true;
          else row.bounced = true;
        }
      }
    }
    // Auth failure isn't fatal here — the report still shows whatever was
    // already settled from previous views; it just can't resolve anything new.
  }

  const report: CampaignReport = {
    campaignId: params.campaignId,
    campaignName,
    sent: rows.length,
    opened: (rows as TrackingRow[]).filter((r) => r.opened).length,
    replied: (rows as TrackingRow[]).filter((r) => r.replied).length,
    bounced: (rows as TrackingRow[]).filter((r) => r.bounced).length,
  };

  return NextResponse.json({ report });
}
