import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import {
  addCallCost,
  addWhatsAppCost,
  emptyUsageCosts,
  roundInr,
  type UsageCosts,
} from "@/lib/member-analytics-cost";
import { callTalkSecondsFromRow } from "@/lib/call-talk-seconds";
import { resolveAnalyticsCallDirection } from "@/lib/analytics-call-direction";
import { getExotelVirtualNumbers } from "@/lib/exotel-numbers";

export const runtime = "nodejs";

// Default 14-day analytics window when ?from/?to aren't passed. Capped at
// 180 days so the response stays bounded.
const DEFAULT_WINDOW_DAYS = 14;
const MAX_WINDOW_DAYS = 180;

type CallRow = {
  user_id: string;
  status: string;
  from_number: string;
  to_number: string;
  duration_seconds: number | null;
  conversation_duration_seconds: number | null;
  recording_duration_seconds: number | null;
  recording_sid: string | null;
  created_at: string;
};

type MessageRow = {
  user_id: string | null;
  direction: string;
  content_type: string | null;
  template_name: string | null;
  body: string | null;
  created_at: string;
};

type JobRow = {
  user_id: string;
  openai_input_tokens: number | null;
  openai_output_tokens: number | null;
  openai_cost_usd: number | null;
  created_at: string;
};

type DaySeriesPoint = {
  date: string; // YYYY-MM-DD
  callsIn: number;
  callsOut: number;
  messages: number;
  tokens: number;
};

type UserAnalytics = {
  userId: string;
  email: string | null;
  displayUsername: string | null;
  role: string;
  totals: {
    callsIn: number;
    callsOut: number;
    callsFailed: number;
    talkMinutes: number;
    smsSent: number;
    whatsappSent: number;
    whatsappReceived: number;
    emailsSent: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
    costs: UsageCosts;
  };
  callStatusBreakdown: Record<string, number>;
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
      callsIn: 0,
      callsOut: 0,
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

// Direction uses the same rules as /api/calls (per-member Exotel line + mobile).

async function assertAdminUserId() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) return { error: "Unauthorized", status: 401 as const };
  const { data: me, error: meErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return { error: meErr.message, status: 500 as const };
  if (me?.role !== "admin") return { error: "Admin only", status: 403 as const };
  return { adminId: user.id };
}

export async function GET(request: Request) {
  const auth = await assertAdminUserId();
  if (!("adminId" in auth)) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

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
    .select("id, role, display_username, mailbox_owner_id, mobile_phone, exotel_virtual_number")
    .or(`id.eq.${auth.adminId},mailbox_owner_id.eq.${auth.adminId}`)
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
    const [callEarliest, waEarliest, smsEarliest, emailEarliest, jobEarliest] = await Promise.all([
      svc.from("call_logs").select("created_at").in("user_id", userIdsForQuery).order("created_at", { ascending: true }).limit(1).maybeSingle(),
      svc.from("whatsapp_messages").select("created_at").in("user_id", userIdsForQuery).order("created_at", { ascending: true }).limit(1).maybeSingle(),
      svc.from("sms_messages").select("created_at").in("user_id", userIdsForQuery).order("created_at", { ascending: true }).limit(1).maybeSingle(),
      svc.from("email_tracking").select("sent_at").in("user_id", userIdsForQuery).order("sent_at", { ascending: true }).limit(1).maybeSingle(),
      svc.from("extraction_jobs").select("created_at").in("user_id", userIdsForQuery).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    ]);
    const candidates = [
      callEarliest.data?.created_at,
      waEarliest.data?.created_at,
      smsEarliest.data?.created_at,
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

  const allVirtuals = await getExotelVirtualNumbers();
  const telephonyByUser = new Map(
    (profiles ?? []).map((p) => [
      p.id as string,
      {
        mobile: ((p.mobile_phone as string | null) ?? "").trim(),
        exotel: ((p.exotel_virtual_number as string | null) ?? "").trim(),
      },
    ])
  );

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
  const [callsRes, smsRes, waRes, emailsRes, jobsRes, ...emailEntries] = await Promise.all([
    svc
      .from("call_logs")
      .select(
        "user_id, status, from_number, to_number, duration_seconds, conversation_duration_seconds, recording_duration_seconds, recording_sid, created_at"
      )
      .in("user_id", userIdsForQuery)
      .gte("created_at", sinceIso)
      .lt("created_at", queryUpperIso),
    svc
      .from("sms_messages")
      .select("user_id, direction, created_at")
      .in("user_id", userIdsForQuery)
      .eq("direction", "outbound")
      .gte("created_at", sinceIso)
      .lt("created_at", queryUpperIso),
    svc
      .from("whatsapp_messages")
      .select("user_id, direction, content_type, template_name, body, created_at")
      .in("user_id", userIdsForQuery)
      .gte("created_at", sinceIso)
      .lt("created_at", queryUpperIso),
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
  for (const { error } of [callsRes, smsRes, waRes, emailsRes, jobsRes]) {
    if (error) {
      // 42P01 = table doesn't exist. Treat as empty rather than failing the
      // whole dashboard — different installs are at different migration levels.
      if (error.code !== "42P01" && !/template_name|conversation_duration_seconds/i.test(error.message)) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  let waRows = ((waRes.data as MessageRow[] | null) ?? []).map((r) => r);
  if (waRes.error && /template_name/i.test(waRes.error.message)) {
    const fallback = await svc
      .from("whatsapp_messages")
      .select("user_id, direction, content_type, body, created_at")
      .in("user_id", userIdsForQuery)
      .gte("created_at", sinceIso)
      .lt("created_at", queryUpperIso);
    if (fallback.error && fallback.error.code !== "42P01") {
      return NextResponse.json({ error: fallback.error.message }, { status: 500 });
    }
    waRows = ((fallback.data as Omit<MessageRow, "template_name">[] | null) ?? []).map((r) => ({
      ...r,
      template_name: null,
    }));
  }


  const result: UserAnalytics[] = userIdsForQuery.map((uid) => {
    const profile = teamProfiles.find((p) => p.id === uid);
    const telephony = telephonyByUser.get(uid) ?? { mobile: "", exotel: "" };
    const series = emptySeries(fromUtc, toUtc);
    const dayIdx = new Map(series.map((s, i) => [s.date, i]));

    const totals = {
      callsIn: 0,
      callsOut: 0,
      callsFailed: 0,
      talkMinutes: 0,
      smsSent: 0,
      whatsappSent: 0,
      whatsappReceived: 0,
      emailsSent: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
      costs: emptyUsageCosts(),
    };
    const callStatusBreakdown: Record<string, number> = {};

    // Calls
    for (const r of (callsRes.data as CallRow[] | null) ?? []) {
      if (r.user_id !== uid) continue;
      const dir = resolveAnalyticsCallDirection(r, telephony.mobile, telephony.exotel, allVirtuals);
      const status = (r.status ?? "").toLowerCase();
      const d = dayKey(r.created_at);
      const i = dayIdx.get(d);
      if (dir === "in") {
        totals.callsIn += 1;
        if (i !== undefined) series[i].callsIn += 1;
      } else {
        totals.callsOut += 1;
        if (i !== undefined) series[i].callsOut += 1;
      }
      if (["failed", "busy", "no-answer"].includes(status)) totals.callsFailed += 1;
      callStatusBreakdown[status] = (callStatusBreakdown[status] ?? 0) + 1;
      const talkSecs = callTalkSecondsFromRow(r);
      if (talkSecs > 0) {
        totals.talkMinutes += talkSecs / 60;
        addCallCost(totals.costs, talkSecs);
      }
    }

    // SMS (outbound only — that's "messages sent")
    for (const r of (smsRes.data as MessageRow[] | null) ?? []) {
      if (r.user_id !== uid) continue;
      totals.smsSent += 1;
      const i = dayIdx.get(dayKey(r.created_at));
      if (i !== undefined) series[i].messages += 1;
    }

    // WhatsApp (inbound + outbound, billed per message)
    for (const r of waRows) {
      if (r.user_id !== uid) continue;
      const dir = (r.direction ?? "").toLowerCase();
      if (dir === "outbound") {
        totals.whatsappSent += 1;
        const i = dayIdx.get(dayKey(r.created_at));
        if (i !== undefined) series[i].messages += 1;
      } else if (dir === "inbound") {
        totals.whatsappReceived += 1;
      }
      addWhatsAppCost(totals.costs, r);
    }

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

    totals.talkMinutes = Math.round(totals.talkMinutes * 10) / 10;
    totals.costUsd = Math.round(totals.costUsd * 10000) / 10000;
    totals.costs.callsInr = roundInr(totals.costs.callsInr);
    totals.costs.whatsappInr = roundInr(totals.costs.whatsappInr);
    totals.costs.totalInr = roundInr(totals.costs.totalInr);

    return {
      userId: uid,
      email: emailById.get(uid) ?? null,
      displayUsername: (profile?.display_username as string | null) ?? null,
      role: (profile?.role as string) ?? "staff",
      totals,
      callStatusBreakdown,
      series,
    };
  });

  // Account-level totals (sum across all team members)
  const accountTotals = result.reduce(
    (acc, u) => ({
      callsIn: acc.callsIn + u.totals.callsIn,
      callsOut: acc.callsOut + u.totals.callsOut,
      talkMinutes: Math.round((acc.talkMinutes + u.totals.talkMinutes) * 10) / 10,
      smsSent: acc.smsSent + u.totals.smsSent,
      whatsappSent: acc.whatsappSent + u.totals.whatsappSent,
      whatsappReceived: acc.whatsappReceived + u.totals.whatsappReceived,
      emailsSent: acc.emailsSent + u.totals.emailsSent,
      costUsd: Math.round((acc.costUsd + u.totals.costUsd) * 10000) / 10000,
      costs: {
        callsInr: roundInr(acc.costs.callsInr + u.totals.costs.callsInr),
        whatsappInr: roundInr(acc.costs.whatsappInr + u.totals.costs.whatsappInr),
        totalInr: roundInr(acc.costs.totalInr + u.totals.costs.totalInr),
        callBillableMinutes: acc.costs.callBillableMinutes + u.totals.costs.callBillableMinutes,
        whatsappUtilityMsgs: acc.costs.whatsappUtilityMsgs + u.totals.costs.whatsappUtilityMsgs,
        whatsappPromotionalMsgs:
          acc.costs.whatsappPromotionalMsgs + u.totals.costs.whatsappPromotionalMsgs,
        whatsappSessionMsgs: acc.costs.whatsappSessionMsgs + u.totals.costs.whatsappSessionMsgs,
      },
    }),
    {
      callsIn: 0,
      callsOut: 0,
      talkMinutes: 0,
      smsSent: 0,
      whatsappSent: 0,
      whatsappReceived: 0,
      emailsSent: 0,
      costUsd: 0,
      costs: emptyUsageCosts(),
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
