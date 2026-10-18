import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { checkThreadForReplyOrBounce, searchForBounceNotification } from "@/lib/email-thread-outcome";
import { createServiceSupabase } from "@/lib/supabase-service";

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

/** Where one person is in a scheduled flow. Absent for an instant mass send. */
export type CampaignRecipientProgress = {
  state: "waiting" | "paused" | "finished" | "replied" | "bounced" | "needs_attention" | "failed" | "removed";
  /** When the next email to this person is due; only while they are still waiting. */
  nextRunAt: string | null;
};

export type CampaignRecipient = {
  email: string;
  /** First email's send time; null while the person is still queued and nothing has gone out. */
  sentAt: string | null;
  opened: boolean;
  openedAt: string | null;
  replied: boolean;
  bounced: boolean;
  /** How many of the flow's emails have actually been sent to this person. */
  emailsSent: number;
  progress?: CampaignRecipientProgress;
};

/** Present when the campaign is a flow scheduled from Compose: what is still queued. */
export type CampaignFlow = {
  sequenceId: string;
  status: string;
  /** Emails in the flow per person (first email plus follow-ups). */
  emailsPerPerson: number;
  /** People with something still to send. */
  waiting: number;
  /** Earliest next send across everyone waiting. */
  nextRunAt: string | null;
};

export type CampaignReport = {
  campaignId: string;
  campaignName: string;
  /** People who have received at least one email. */
  sent: number;
  opened: number;
  replied: number;
  bounced: number;
  recipients: CampaignRecipient[];
  flow?: CampaignFlow;
};

type FlowEnrollment = { email: string; status: string; next_run_at: string | null };
type FlowData = {
  sequenceId: string;
  status: string;
  emailsPerPerson: number;
  enrollments: FlowEnrollment[];
};

/**
 * The queue behind a campaign that was scheduled from Compose. The campaign id is the flow's id, so
 * the same page can say what has gone out and what is still waiting. Read with the service role
 * (the flow tables are not exposed to the browser), after checking the viewer owns it: either they
 * already have sent rows for it, or they are the person who scheduled it.
 */
async function loadFlow(campaignId: string, userId: string, hasRows: boolean): Promise<FlowData | null> {
  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return null;
  }
  const { data: seq } = await svc
    .from("sequences")
    .select("id, status, created_by")
    .eq("id", campaignId)
    .eq("origin", "scheduled")
    .maybeSingle();
  if (!seq) return null;
  if (!hasRows && (seq as { created_by: string | null }).created_by !== userId) return null;

  const [{ count: emailSteps }, { data: enrollments }] = await Promise.all([
    svc.from("sequence_steps").select("id", { count: "exact", head: true }).eq("sequence_id", campaignId).eq("kind", "email"),
    svc
      .from("sequence_enrollments")
      .select("email, status, next_run_at")
      .eq("sequence_id", campaignId)
      .neq("status", "removed")
      .limit(5000),
  ]);

  return {
    sequenceId: campaignId,
    status: (seq as { status: string }).status,
    emailsPerPerson: emailSteps ?? 1,
    enrollments: (enrollments ?? []) as FlowEnrollment[],
  };
}

function progressFor(e: FlowEnrollment, flowActive: boolean): CampaignRecipientProgress {
  switch (e.status) {
    case "active":
      return { state: flowActive ? "waiting" : "paused", nextRunAt: flowActive ? e.next_run_at : null };
    case "paused":
      return { state: "paused", nextRunAt: null };
    case "completed":
      return { state: "finished", nextRunAt: null };
    case "replied":
    case "bounced":
    case "needs_attention":
    case "failed":
    case "removed":
      return { state: e.status, nextRunAt: null };
    default:
      return { state: "finished", nextRunAt: null };
  }
}

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

function buildReport(campaignId: string, rows: TrackingRow[], flow: FlowData | null): CampaignReport {
  // One entry per person, not per email: a flow scheduled with follow-ups stamps every email it
  // sends, so a recipient can have several rows. An instant mass send has exactly one each, so
  // this changes nothing there.
  const byRecipient = new Map<string, TrackingRow[]>();
  for (const row of rows) {
    const key = row.to_address.trim().toLowerCase();
    const list = byRecipient.get(key);
    if (list) list.push(row);
    else byRecipient.set(key, [row]);
  }

  const flowActive = flow?.status === "active";
  const enrollmentByEmail = new Map<string, FlowEnrollment>();
  for (const e of flow?.enrollments ?? []) enrollmentByEmail.set(e.email.trim().toLowerCase(), e);

  const recipients: CampaignRecipient[] = Array.from(byRecipient.entries()).map(([key, list]) => {
    const openedAts = list.map((r) => r.opened_at).filter((v): v is string => !!v);
    const enrollment = enrollmentByEmail.get(key);
    return {
      email: list[0].to_address,
      sentAt: list.map((r) => r.sent_at).sort()[0],
      opened: list.some((r) => r.opened),
      openedAt: openedAts.length ? openedAts.sort()[0] : null,
      replied: list.some((r) => r.replied),
      bounced: list.some((r) => r.bounced),
      emailsSent: list.length,
      ...(enrollment ? { progress: progressFor(enrollment, flowActive) } : {}),
    };
  });

  // People queued in the flow who have not been sent anything yet still belong in the report — it
  // is the one place that says they are coming.
  for (const [key, enrollment] of Array.from(enrollmentByEmail.entries())) {
    if (byRecipient.has(key)) continue;
    recipients.push({
      email: enrollment.email,
      sentAt: null,
      opened: false,
      openedAt: null,
      replied: false,
      bounced: false,
      emailsSent: 0,
      progress: progressFor(enrollment, flowActive),
    });
  }
  recipients.sort((a, b) => a.email.localeCompare(b.email));

  const sentPeople = recipients.filter((r) => r.sentAt !== null);
  const waiting = recipients.filter((r) => r.progress?.state === "waiting");
  const nextRuns = waiting.map((r) => r.progress?.nextRunAt).filter((v): v is string => !!v).sort();

  return {
    campaignId,
    campaignName: rows[0]?.campaign_name || "Untitled campaign",
    sent: sentPeople.length,
    opened: sentPeople.filter((r) => r.opened).length,
    replied: sentPeople.filter((r) => r.replied).length,
    bounced: sentPeople.filter((r) => r.bounced).length,
    recipients,
    ...(flow
      ? {
          flow: {
            sequenceId: flow.sequenceId,
            status: flow.status,
            emailsPerPerson: flow.emailsPerPerson,
            waiting: waiting.length,
            nextRunAt: nextRuns[0] ?? null,
          },
        }
      : {}),
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
export async function GET(request: Request, props: { params: Promise<{ campaignId: string }> }) {
  const params = await props.params;
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = (await fetchTrackingRows(supabase, user.id, params.campaignId)) ?? [];
  const flow = await loadFlow(params.campaignId, user.id, rows.length > 0);
  // A flow that has not sent anything yet has no rows but is still a real campaign to look at.
  if (rows.length === 0 && !flow) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  return NextResponse.json({ report: buildReport(params.campaignId, rows, flow) });
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
export async function POST(request: Request, props: { params: Promise<{ campaignId: string }> }) {
  const params = await props.params;
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rows = (await fetchTrackingRows(supabase, user.id, params.campaignId)) ?? [];
  const flow = await loadFlow(params.campaignId, user.id, rows.length > 0);
  if (rows.length === 0 && !flow) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const pendingAll = rows.filter((r) => !r.replied && !r.bounced && r.gmail_thread_id);
  // Follow-ups share their first email's thread, so check each thread once and apply the outcome to
  // every row in it.
  const seenThreads = new Set<string>();
  const pending = pendingAll.filter((r) => {
    if (seenThreads.has(r.gmail_thread_id!)) return false;
    seenThreads.add(r.gmail_thread_id!);
    return true;
  });
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
        const checked = rows.find((r) => r.id === id);
        // Every still-pending row in the same thread gets the same outcome.
        const sameThread = pendingAll.filter((r) => r.gmail_thread_id === checked?.gmail_thread_id);
        for (const row of sameThread.length ? sameThread : checked ? [checked] : []) {
          const { error: updateErr } = await supabase
            .from("email_tracking")
            .update(
              outcome === "replied" ? { replied: true, replied_at: now } : { bounced: true, bounced_at: now }
            )
            .eq("id", row.id);
          if (updateErr) continue;
          if (outcome === "replied") row.replied = true;
          else row.bounced = true;
        }
      }
    }
    // Auth failure isn't fatal — return whatever was already settled.
  }

  return NextResponse.json({ report: buildReport(params.campaignId, rows, flow) });
}
