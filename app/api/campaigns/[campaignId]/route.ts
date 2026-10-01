import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { checkThreadForReplyOrBounce, searchForBounceNotification } from "@/lib/email-thread-outcome";

export const runtime = "nodejs";

type TrackingRow = {
  id: string;
  to_address: string;
  gmail_thread_id: string | null;
  sent_at: string;
  opened: boolean;
  opened_at: string | null;
  replied: boolean;
  bounced: boolean;
  campaign_name: string | null;
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

async function fetchTrackingRows(
  supabase: SupabaseClient,
  userId: string,
  campaignId: string
): Promise<TrackingRow[] | null> {
  const { data } = await supabase
    .from("email_tracking")
    .select("id, to_address, gmail_thread_id, sent_at, opened, opened_at, replied, bounced, campaign_name")
    .eq("user_id", userId)
    .eq("campaign_id", campaignId);
  return (data as TrackingRow[] | null) ?? null;
}

function buildReport(campaignId: string, rows: TrackingRow[]): CampaignReport {
  return {
    campaignId,
    campaignName: rows[0]?.campaign_name || "Untitled campaign",
    sent: rows.length,
    opened: rows.filter((r) => r.opened).length,
    replied: rows.filter((r) => r.replied).length,
    bounced: rows.filter((r) => r.bounced).length,
    recipients: rows
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
}

/**
 * GET /api/campaigns/[campaignId] — Sent/Opened/Responded/Bounced for one
 * mass send.
 *
 * A pure read — no Gmail calls happen here, so loading or navigating to this
 * page never spends quota. replied/bounced are kept current passively day to
 * day, piggybacked onto threads the app opens anyway for other reasons — see
 * lib/tracking-passive-sync.ts. That's enough for ambient use, but it means a
 * recipient who replied without you having opened that thread in the inbox
 * yet won't show here until you do (or until you hit Refresh — see POST).
 */
export async function GET(request: Request, { params }: { params: { campaignId: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await fetchTrackingRows(supabase, user.id, params.campaignId);
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  return NextResponse.json({ report: buildReport(params.campaignId, rows) });
}

/**
 * POST /api/campaigns/[campaignId] — the report's "Refresh" button.
 *
 * Unlike GET, this actively checks Gmail for every still-pending recipient —
 * the same live check the whole report used to do on every view (see git
 * history). The difference is *when* it runs: only on an explicit click,
 * not every time someone loads or navigates to the page. A person pressing
 * Refresh because they specifically want current numbers right now is rare
 * and intentional, which is a real browser-click's worth of quota rather than
 * the automatic, unbounded cost a plain page view was paying before.
 */
export async function POST(request: Request, { params }: { params: { campaignId: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await fetchTrackingRows(supabase, user.id, params.campaignId);
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const pending = rows.filter((r) => !r.replied && !r.bounced && r.gmail_thread_id);
  if (pending.length > 0) {
    const auth = await requireGmailAccessToken(request);
    if (auth.ok) {
      const results = await Promise.all(
        pending.map(async (row) => {
          const sinceMs = Date.parse(row.sent_at) || 0;
          const threadOutcome = await checkThreadForReplyOrBounce(auth.accessToken, row.gmail_thread_id!, {
            mailboxAddress: auth.gmailAddress,
            firstSentAt: sinceMs,
            mailboxKey: auth.mailboxOwnerId,
          }).catch(() => null);
          if (threadOutcome) return { id: row.id, outcome: threadOutcome };

          // Gmail bounce notices commonly land as their own thread rather
          // than the one that bounced — only worth searching once the
          // thread itself came back empty.
          const bounced = await searchForBounceNotification(auth.accessToken, row.to_address, {
            sinceMs,
            mailboxKey: auth.mailboxOwnerId,
          }).catch(() => false);
          return { id: row.id, outcome: bounced ? ("bounced" as const) : null };
        })
      );

      const now = new Date().toISOString();
      for (const { id, outcome } of results) {
        if (!outcome) continue;
        const { error: updateErr } = await supabase
          .from("email_tracking")
          .update(
            outcome === "replied" ? { replied: true, replied_at: now } : { bounced: true, bounced_at: now }
          )
          .eq("id", id);
        if (updateErr) continue;
        const row = rows.find((r) => r.id === id);
        if (row) {
          if (outcome === "replied") row.replied = true;
          else row.bounced = true;
        }
      }
    }
    // Auth failure isn't fatal — return whatever was already settled.
  }

  return NextResponse.json({ report: buildReport(params.campaignId, rows) });
}
