import { NextResponse } from "next/server";
import { getAuthedRequest } from "@/lib/api-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { countEmailsByMember, type Outcomes, type ResponseRow, type SequenceSendRow, type TrackingRow } from "@/lib/analytics-emails";

export const runtime = "nodejs";

// Default 14-day analytics window when ?from/?to aren't passed. Capped at
// 180 days so the response stays bounded.
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 180;

type JobRow = {
  user_id: string;
  openai_input_tokens: number | null;
  openai_output_tokens: number | null;
  openai_cost_usd: number | null;
  created_at: string;
};

type DaySeriesPoint = {
  date: string; // YYYY-MM-DD
  /** Emails sent that day (composer + sequences), and what has become of them since. */
  messages: number;
  opened: number;
  replied: number;
  bounced: number;
  tokens: number;
};

type UserAnalytics = {
  userId: string;
  email: string | null;
  displayUsername: string | null;
  role: string;
  totals: {
    emailsSent: number;
    /** Of emailsSent: opened and bounced; `openTracked` = those whose opens can be measured (the open rate's base). `replied` = replies received in the range (each message). */
    opened: number;
    openTracked: number;
    replied: number;
    /** Addresses that couldn't be delivered to, and addresses emailed (the bounce rate's base). */
    bounced: number;
    recipients: number;
    /** ISO time of their most recent email in the range, or null. */
    lastEmailAt: string | null;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  series: DaySeriesPoint[];
};

function dayKey(iso: string): string {
  // Group by local UTC day — good enough for trend bars. If precise IST is
  // needed later, swap to a tz-aware formatter.
  return iso.slice(0, 10);
}

/** Build a zero-filled day series from `fromUtc` to `toUtc` inclusive. */
function emptySeries(fromUtc: Date, toUtc: Date): DaySeriesPoint[] {
  const series: DaySeriesPoint[] = [];
  const d = new Date(fromUtc);
  while (d.getTime() <= toUtc.getTime()) {
    series.push({
      date: d.toISOString().slice(0, 10),
      messages: 0,
      opened: 0,
      replied: 0,
      bounced: 0,
      tokens: 0,
    });
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return series;
}

/** Parse YYYY-MM-DD into a UTC midnight Date, or null if invalid. */
function parseDateOnly(s: string | null): Date | null {
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function GET(request: Request) {
  // Per-step timings, returned as a Server-Timing header (visible in the
  // browser's network panel) so slow steps can be spotted without guessing.
  const timings: string[] = [];
  let mark = Date.now();
  const lap = (name: string) => {
    const now = Date.now();
    timings.push(`${name};dur=${now - mark}`);
    mark = now;
  };

  // Sign-in only here; the admin check rides on the roster query below (it
  // returns the caller's own profile), saving a sequential round trip.
  const authed = await getAuthedRequest(request);
  lap("auth");
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const adminId = authed.user.id;

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const requestedUserId = searchParams.get("userId") || null;
  const allTime = searchParams.get("allTime") === "1";

  // Window: `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both UTC midnights, inclusive).
  // `?allTime=1` loads from earliest team activity. Otherwise defaults to
  // DEFAULT_WINDOW_DAYS and clamps to MAX_WINDOW_DAYS.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const defaultFrom = new Date(today);
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - (DEFAULT_WINDOW_DAYS - 1));

  const fromParam = parseDateOnly(searchParams.get("from"));
  const toParam = parseDateOnly(searchParams.get("to"));
  let fromUtc = fromParam ?? defaultFrom;
  let toUtc = toParam ?? today;
  if (fromUtc.getTime() > toUtc.getTime()) {
    [fromUtc, toUtc] = [toUtc, fromUtc];
  }
  if (!allTime) {
    const maxSpan = (MAX_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000;
    if (toUtc.getTime() - fromUtc.getTime() > maxSpan) {
      fromUtc = new Date(toUtc.getTime() - maxSpan);
    }
  }
  // Query bounds and window length are derived from fromUtc/toUtc. They are
  // computed by this helper both here and again once "all time" has found its
  // real start — they used to be fixed once, up here, so "all time" queried only
  // the default 14 days while drawing a chart that started months earlier.
  const windowBounds = () => ({
    // Upper bound is exclusive next-day-midnight so `lt` catches all of `toUtc`.
    queryUpperIso: new Date(toUtc.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    sinceIso: fromUtc.toISOString(),
    windowDays: Math.round((toUtc.getTime() - fromUtc.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  });
  let { queryUpperIso, sinceIso, windowDays } = windowBounds();

  // Build the team roster — admins are excluded from analytics output
  // (the admin sees their team's activity, not their own row in the table).
  // For the per-user `?userId=…` request we still allow the admin's own
  // userId so the admin can drill into themselves if they go via direct URL.
  lap("setup");
  const { data: profiles, error: profileErr } = await svc
    .from("profiles")
    .select("id, role, display_username, mailbox_owner_id")
    .or(`id.eq.${adminId},mailbox_owner_id.eq.${adminId}`)
    .order("created_at", { ascending: true });
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }
  if ((profiles ?? []).find((p) => p.id === adminId)?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const teamProfiles = (profiles ?? []).filter(
    (p) => requestedUserId ? p.id === requestedUserId : (p.role as string) !== "admin"
  );
  const teamUserIds = teamProfiles.map((p) => p.id as string);
  if (requestedUserId && !(profiles ?? []).some((p) => p.id === requestedUserId)) {
    return NextResponse.json({ error: "User not in your team" }, { status: 403 });
  }
  if (teamUserIds.length === 0) {
    return NextResponse.json({
      users: [],
      windowDays,
      from: fromUtc.toISOString().slice(0, 10),
      to: toUtc.toISOString().slice(0, 10),
    });
  }
  const userIdsForQuery = teamUserIds;

  lap("roster");
  if (allTime) {
    // No lower bound: read everything up to today, then start the chart at the
    // first activity found in those rows (below). This used to be a separate
    // "find the earliest date" round trip before the data queries.
    toUtc = today;
    ({ queryUpperIso } = windowBounds());
    sinceIso = new Date(0).toISOString();
  }

  // Pull activity rows + emails in one parallel batch. Switching from
  // auth.admin.listUsers (which pages through ALL auth users) to per-team
  // getUserById calls cuts the slow path: we only fetch the team's emails,
  // and these run alongside the activity queries.
  const emailPromises = userIdsForQuery.map((uid) =>
    svc.auth.admin
      .getUserById(uid)
      .then((r) => [uid, r.data.user?.email ?? null] as const)
      .catch(() => [uid, null] as const)
  );

  // Pull activity rows scoped to the team window. We do per-query .in() filters
  // so RLS-bypass (service role) is targeted, not table-wide. Upper bound
  // (`lt`) is exclusive next-day-midnight so `toUtc` itself is included.
  // Composer sends, with who they went to and which addresses failed (0071).
  // Before that migration those columns don't exist — read without them.
  const fetchTrackingRows = async () => {
    const page = (columns: string) =>
      fetchAllRows<TrackingRow>((from, to) =>
        svc
          .from("email_tracking")
          .select(columns)
          .in("user_id", userIdsForQuery)
          .gte("sent_at", sinceIso)
          .lt("sent_at", queryUpperIso)
          .order("sent_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to) as unknown as PromiseLike<{ data: TrackingRow[] | null; error: { message: string } | null }>
      );
    const full = await page("id, user_id, sent_at, opened, bounced, to_address, cc_address, bcc_address, bounced_recipients");
    return full.error && /column|42703/i.test(full.error) ? page("id, user_id, sent_at, opened, bounced") : full;
  };

  // Paged: PostgREST silently stops at 1,000 rows per request, and sequences
  // send enough mail to cross that inside one 180-day window.
  const [emailsRes, jobsRes, seqRes, responsesRes, ...emailEntries] = await Promise.all([
    fetchTrackingRows(),
    fetchAllRows<JobRow & { id: string }>((from, to) =>
      svc
        .from("extraction_jobs")
        .select("id, user_id, openai_input_tokens, openai_output_tokens, openai_cost_usd, created_at")
        .in("user_id", userIdsForQuery)
        .gte("created_at", sinceIso)
        .lt("created_at", queryUpperIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    // Sequence mail leaves from cron, not from a signed-in user, so it is read
    // from the send log and credited to whoever enrolled the recipient. Only
    // "sent" rows: a sequence that exited early (reply, bounce, removed) never
    // writes one for the steps it skipped, so those are not counted.
    fetchAllRows<SequenceSendRow>((from, to) =>
      svc
        .from("sequence_sends")
        .select("id, enrollment_id, created_at, tracking_id, sequence_enrollments(enrolled_by, status, last_sent_at), sequences(created_by), email_tracking(opened)")
        .eq("mailbox_owner_id", adminId)
        .eq("status", "sent")
        .gte("created_at", sinceIso)
        .lt("created_at", queryUpperIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    // Every reply received in the range — each message counts (0070). Counted
    // by when it arrived, not by when the email it answers was sent.
    fetchAllRows<ResponseRow & { id: string }>((from, to) =>
      svc
        .from("email_responses")
        .select("id, user_id, received_at")
        .in("user_id", userIdsForQuery)
        .gte("received_at", sinceIso)
        .lt("received_at", queryUpperIso)
        .order("received_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    ...emailPromises,
  ]);

  lap("data");
  if (allTime) {
    const firsts = [
      emailsRes.data[0]?.sent_at,
      jobsRes.data[0]?.created_at,
      seqRes.data[0]?.created_at,
    ].filter((v): v is string => typeof v === "string" && v.length > 0);
    if (firsts.length > 0) {
      fromUtc = new Date(firsts.sort()[0]);
      fromUtc.setUTCHours(0, 0, 0, 0);
    } else {
      fromUtc = new Date(today);
      fromUtc.setUTCFullYear(fromUtc.getUTCFullYear() - 1);
    }
    ({ windowDays } = windowBounds());
  }
  const emailById = new Map<string, string | null>(emailEntries);

  // Surface the first hard error if any; missing tables (e.g. migration not
  // applied) give a friendlier message than a 500.
  // A table that isn't there yet (its migration not applied) reads as empty
  // rather than failing the whole page.
  for (const { error } of [emailsRes, jobsRes, seqRes, responsesRes]) {
    if (error && !/does not exist|42P01|schema cache|PGRST205/i.test(error)) {
      return NextResponse.json({ error }, { status: 500 });
    }
  }

  const emailCounts = countEmailsByMember({
    userIds: userIdsForQuery,
    mailboxOwnerId: adminId,
    tracking: emailsRes.data,
    sequenceSends: seqRes.data,
    responses: responsesRes.data,
    windowEndIso: queryUpperIso,
  });

  const jobsByUser = new Map<string, JobRow[]>();
  for (const r of jobsRes.data) {
    const list = jobsByUser.get(r.user_id) ?? [];
    list.push(r);
    jobsByUser.set(r.user_id, list);
  }

  const result: UserAnalytics[] = userIdsForQuery.map((uid) => {
    const profile = teamProfiles.find((p) => p.id === uid);
    const series = emptySeries(fromUtc, toUtc);
    const dayIdx = new Map(series.map((s, i) => [s.date, i]));

    const totals = {
      emailsSent: 0,
      opened: 0,
      openTracked: 0,
      replied: 0,
      bounced: 0,
      recipients: 0,
      lastEmailAt: null as string | null,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };

    // Email (composer sends + sequence sends, merged per member)
    const counts = emailCounts.get(uid);
    if (counts) {
      totals.emailsSent = counts.sent;
      totals.opened = counts.opened;
      totals.openTracked = counts.openTracked;
      totals.replied = counts.replied;
      totals.bounced = counts.bounced;
      totals.recipients = counts.recipients;
      totals.lastEmailAt = counts.lastEmailAt;
      counts.perDay.forEach((day: Outcomes, key) => {
        const i = dayIdx.get(key);
        if (i === undefined) return;
        series[i].messages += day.sent;
        series[i].opened += day.opened;
        series[i].replied += day.replied;
        series[i].bounced += day.bounced;
      });
    }

    // Token usage
    for (const r of jobsByUser.get(uid) ?? []) {
      const tIn = r.openai_input_tokens ?? 0;
      const tOut = r.openai_output_tokens ?? 0;
      totals.tokensIn += tIn;
      totals.tokensOut += tOut;
      totals.costUsd += Number(r.openai_cost_usd ?? 0);
      const i = dayIdx.get(dayKey(r.created_at));
      if (i !== undefined) series[i].tokens += tIn + tOut;
    }

    totals.costUsd = Math.round(totals.costUsd * 10000) / 10000;

    return {
      userId: uid,
      email: emailById.get(uid) ?? null,
      displayUsername: (profile?.display_username as string | null) ?? null,
      role: (profile?.role as string) ?? "staff",
      totals,
      series,
    };
  });

  // Account-level totals (sum across all team members)
  const accountTotals = result.reduce(
    (acc, u) => ({
      emailsSent: acc.emailsSent + u.totals.emailsSent,
      opened: acc.opened + u.totals.opened,
      openTracked: acc.openTracked + u.totals.openTracked,
      replied: acc.replied + u.totals.replied,
      bounced: acc.bounced + u.totals.bounced,
      recipients: acc.recipients + u.totals.recipients,
      costUsd: Math.round((acc.costUsd + u.totals.costUsd) * 10000) / 10000,
    }),
    {
      emailsSent: 0,
      opened: 0,
      openTracked: 0,
      replied: 0,
      bounced: 0,
      recipients: 0,
      costUsd: 0,
    }
  );

  lap("compute");
  return NextResponse.json(
    {
      users: result,
      accountTotals,
      windowDays,
      allTime,
      from: fromUtc.toISOString().slice(0, 10),
      to: toUtc.toISOString().slice(0, 10),
    },
    {
      headers: {
        // No browser caching: a reused answer showed a team member added a
        // moment ago as missing until a reload (and likewise new emails and
        // replies). Each visit asks the server.
        "Cache-Control": "private, no-store",
        "Server-Timing": [...timings, "total;dur=" + timings.reduce((n, t) => n + Number(t.split("dur=")[1]), 0)].join(", "),
      },
    }
  );
}
