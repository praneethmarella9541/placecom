import { NextResponse } from "next/server";
import { assertAdminUserId } from "@/lib/admin-auth";
import { createServiceSupabase } from "@/lib/supabase-service";

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
  messages: number;
  tokens: number;
};

type UserAnalytics = {
  userId: string;
  email: string | null;
  displayUsername: string | null;
  role: string;
  totals: {
    emailsSent: number;
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
  const auth = await assertAdminUserId(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const adminId = auth.userId;

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
  // Query upper bound is exclusive next-day-midnight so `lt` catches all of `toUtc`
  const queryUpperIso = new Date(toUtc.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const sinceIso = fromUtc.toISOString();
  const windowDays =
    Math.round((toUtc.getTime() - fromUtc.getTime()) / (24 * 60 * 60 * 1000)) + 1;

  // Build the team roster — admins are excluded from analytics output
  // (the admin sees their team's activity, not their own row in the table).
  // For the per-user `?userId=…` request we still allow the admin's own
  // userId so the admin can drill into themselves if they go via direct URL.
  const { data: profiles, error: profileErr } = await svc
    .from("profiles")
    .select("id, role, display_username, mailbox_owner_id")
    .or(`id.eq.${adminId},mailbox_owner_id.eq.${adminId}`)
    .order("created_at", { ascending: true });
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
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

  if (allTime) {
    const [emailEarliest, jobEarliest] = await Promise.all([
      svc.from("email_tracking").select("sent_at").in("user_id", userIdsForQuery).order("sent_at", { ascending: true }).limit(1).maybeSingle(),
      svc.from("extraction_jobs").select("created_at").in("user_id", userIdsForQuery).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const candidates = [
      emailEarliest.data?.sent_at,
      jobEarliest.data?.created_at,
    ]
      .filter((v): v is string => typeof v === "string" && v.length > 0)
      .map((iso) => new Date(iso));
    if (candidates.length > 0) {
      const earliest = new Date(Math.min(...candidates.map((d) => d.getTime())));
      earliest.setUTCHours(0, 0, 0, 0);
      fromUtc = earliest;
    } else {
      fromUtc = new Date(today);
      fromUtc.setUTCFullYear(fromUtc.getUTCFullYear() - 1);
    }
    toUtc = today;
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
  const [emailsRes, jobsRes, ...emailEntries] = await Promise.all([
    svc
      .from("email_tracking")
      .select("user_id, sent_at")
      .in("user_id", userIdsForQuery)
      .gte("sent_at", sinceIso)
      .lt("sent_at", queryUpperIso),
    svc
      .from("extraction_jobs")
      .select("user_id, openai_input_tokens, openai_output_tokens, openai_cost_usd, created_at")
      .in("user_id", userIdsForQuery)
      .gte("created_at", sinceIso)
      .lt("created_at", queryUpperIso),
    ...emailPromises,
  ]);

  const emailById = new Map<string, string | null>(emailEntries);

  // Surface the first hard error if any; missing tables (e.g. migration not
  // applied) give a friendlier message than a 500.
  for (const { error } of [emailsRes, jobsRes]) {
    if (error && error.code !== "42P01") {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  const result: UserAnalytics[] = userIdsForQuery.map((uid) => {
    const profile = teamProfiles.find((p) => p.id === uid);
    const series = emptySeries(fromUtc, toUtc);
    const dayIdx = new Map(series.map((s, i) => [s.date, i]));

    const totals = {
      emailsSent: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };

    // Email
    for (const r of (emailsRes.data as { user_id: string; sent_at: string }[] | null) ?? []) {
      if (r.user_id !== uid) continue;
      totals.emailsSent += 1;
      const i = dayIdx.get(dayKey(r.sent_at));
      if (i !== undefined) series[i].messages += 1;
    }

    // Token usage
    for (const r of (jobsRes.data as JobRow[] | null) ?? []) {
      if (r.user_id !== uid) continue;
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
      costUsd: Math.round((acc.costUsd + u.totals.costUsd) * 10000) / 10000,
    }),
    {
      emailsSent: 0,
      costUsd: 0,
    }
  );

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
        // Short browser cache + 60s stale-while-revalidate so switching
        // between the overview and a detail page (and back) feels instant
        // without holding onto stale data for long.
        "Cache-Control": "private, max-age=30, stale-while-revalidate=60",
      },
    }
  );
}
