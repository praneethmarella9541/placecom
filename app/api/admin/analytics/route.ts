import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";

export const runtime = "nodejs";

// 14-day analytics window (today inclusive). Keep it small so the response
// is fast and the charts stay readable.
const WINDOW_DAYS = 14;

type CallRow = {
  user_id: string;
  status: string;
  from_number: string;
  to_number: string;
  duration_seconds: number | null;
  created_at: string;
};

type MessageRow = {
  user_id: string | null;
  direction: string;
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
    emailsSent: number;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  callStatusBreakdown: Record<string, number>;
  series: DaySeriesPoint[];
};

function dayKey(iso: string): string {
  // Group by local UTC day — good enough for trend bars. If precise IST is
  // needed later, swap to a tz-aware formatter.
  return iso.slice(0, 10);
}

function emptySeries(): DaySeriesPoint[] {
  const today = new Date();
  const series: DaySeriesPoint[] = [];
  for (let i = WINDOW_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    series.push({
      date: d.toISOString().slice(0, 10),
      callsIn: 0,
      callsOut: 0,
      messages: 0,
      tokens: 0,
    });
  }
  return series;
}

// Same convention as /api/calls: if from_number matches our virtual number,
// it's outbound (the call was placed via Exotel on the user's behalf).
function callDirection(row: CallRow, virtualNumberNorm: string): "in" | "out" {
  const norm = (s: string | null | undefined) =>
    (s ?? "").replace(/[\s\-().]/g, "").replace(/^0/, "").replace(/^\+?91/, "").replace(/^\+/, "");
  const fromN = norm(row.from_number);
  if (virtualNumberNorm && fromN === virtualNumberNorm) return "out";
  // Fallback: anything not from the virtual number is treated as incoming.
  return "in";
}

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

  // Window start (00:00 UTC, WINDOW_DAYS-1 days ago).
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (WINDOW_DAYS - 1));
  const sinceIso = since.toISOString();

  // Build the team roster (admin + their team), then optionally narrow to one.
  const { data: profiles, error: profileErr } = await svc
    .from("profiles")
    .select("id, role, display_username, mailbox_owner_id")
    .or(`id.eq.${auth.adminId},mailbox_owner_id.eq.${auth.adminId}`)
    .order("created_at", { ascending: true });
  if (profileErr) {
    return NextResponse.json({ error: profileErr.message }, { status: 500 });
  }

  const teamUserIds = (profiles ?? []).map((p) => p.id as string);
  if (requestedUserId && !teamUserIds.includes(requestedUserId)) {
    return NextResponse.json({ error: "User not in your team" }, { status: 403 });
  }
  const userIdsForQuery = requestedUserId ? [requestedUserId] : teamUserIds;
  if (userIdsForQuery.length === 0) {
    return NextResponse.json({ users: [], windowDays: WINDOW_DAYS });
  }

  // Email lookup (auth.admin.listUsers is paged; team size is small).
  const emailById = new Map<string, string | null>();
  try {
    const users = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of users.data.users ?? []) {
      emailById.set(u.id, u.email ?? null);
    }
  } catch {
    // Non-fatal — caller will just see null emails.
  }

  // Pull activity rows scoped to the team window. We do per-query .in() filters
  // so RLS-bypass (service role) is targeted, not table-wide.
  const [callsRes, smsRes, waRes, emailsRes, jobsRes] = await Promise.all([
    svc
      .from("call_logs")
      .select("user_id, status, from_number, to_number, duration_seconds, created_at")
      .in("user_id", userIdsForQuery)
      .gte("created_at", sinceIso),
    svc
      .from("sms_messages")
      .select("user_id, direction, created_at")
      .in("user_id", userIdsForQuery)
      .eq("direction", "outbound")
      .gte("created_at", sinceIso),
    svc
      .from("whatsapp_messages")
      .select("user_id, direction, created_at")
      .in("user_id", userIdsForQuery)
      .eq("direction", "outbound")
      .gte("created_at", sinceIso),
    svc
      .from("email_tracking")
      .select("user_id, sent_at")
      .in("user_id", userIdsForQuery)
      .gte("sent_at", sinceIso),
    svc
      .from("extraction_jobs")
      .select("user_id, openai_input_tokens, openai_output_tokens, openai_cost_usd, created_at")
      .in("user_id", userIdsForQuery)
      .gte("created_at", sinceIso),
  ]);

  // Surface the first hard error if any; missing tables (e.g. migration not
  // applied) give a friendlier message than a 500.
  for (const { error } of [callsRes, smsRes, waRes, emailsRes, jobsRes]) {
    if (error) {
      // 42P01 = table doesn't exist. Treat as empty rather than failing the
      // whole dashboard — different installs are at different migration levels.
      if (error.code !== "42P01") {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
    }
  }

  const virtualNumberNorm = (process.env.EXOTEL_VIRTUAL_NUMBER ?? "")
    .replace(/[\s\-().]/g, "")
    .replace(/^0/, "")
    .replace(/^\+?91/, "")
    .replace(/^\+/, "");

  const result: UserAnalytics[] = userIdsForQuery.map((uid) => {
    const profile = (profiles ?? []).find((p) => p.id === uid);
    const series = emptySeries();
    const dayIdx = new Map(series.map((s, i) => [s.date, i]));

    const totals = {
      callsIn: 0,
      callsOut: 0,
      callsFailed: 0,
      talkMinutes: 0,
      smsSent: 0,
      whatsappSent: 0,
      emailsSent: 0,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    };
    const callStatusBreakdown: Record<string, number> = {};

    // Calls
    for (const r of (callsRes.data as CallRow[] | null) ?? []) {
      if (r.user_id !== uid) continue;
      const dir = callDirection(r, virtualNumberNorm);
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
      if (r.duration_seconds && status === "completed") {
        totals.talkMinutes += r.duration_seconds / 60;
      }
    }

    // SMS (outbound only — that's "messages sent")
    for (const r of (smsRes.data as MessageRow[] | null) ?? []) {
      if (r.user_id !== uid) continue;
      totals.smsSent += 1;
      const i = dayIdx.get(dayKey(r.created_at));
      if (i !== undefined) series[i].messages += 1;
    }

    // WhatsApp (outbound)
    for (const r of (waRes.data as MessageRow[] | null) ?? []) {
      if (r.user_id !== uid) continue;
      totals.whatsappSent += 1;
      const i = dayIdx.get(dayKey(r.created_at));
      if (i !== undefined) series[i].messages += 1;
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

  return NextResponse.json({
    users: result,
    windowDays: WINDOW_DAYS,
    since: sinceIso,
  });
}
