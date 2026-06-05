import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";
import { normalizePhone, phoneLookupVariants, phoneMatches } from "@/lib/phone";
import { deriveCallDirection, resolveCallStatus } from "@/lib/call-status";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// CallType values Exotel sends AFTER the call has ended.
// IMPORTANT: 'call-attempt' is sent BEFORE the Connect applet's dial step
// (it means "IVR only so far, no connect applet"), so it's NOT terminal —
// treating it as terminal makes us return ok:true instead of the destination,
// and Exotel then has nothing to dial.
const TERMINAL_CALL_TYPES = new Set([
  "completed", "incomplete", "client-hangup", "voicemail",
]);


async function fetchRecordingUrl(callSid: string): Promise<string | null> {
  const sid      = process.env.EXOTEL_SID?.trim();
  const apiKey   = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();
  if (!sid || !apiKey || !apiToken) return null;

  // Exotel recordings API — may not be ready immediately; caller should retry
  const url = `https://api.exotel.com/v1/Accounts/${sid}/Calls/${callSid}/Recordings.json`;
  const basic = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");
  try {
    const res = await fetch(url, { headers: { Authorization: `Basic ${basic}` } });
    if (!res.ok) return null;
    const json = await res.json();
    // Response: { TwilioResponse: { RecordingList: { Recording: [...] | {} } } }
    const list = json?.TwilioResponse?.RecordingList?.Recording;
    type ExotelRecording = { Uri?: string; RecordingUrl?: string };
    const recordings: ExotelRecording[] = Array.isArray(list) ? list : list ? [list] : [];
    if (recordings.length === 0) return null;
    // Return the first recording's URI (an S3 URL or API path)
    return recordings[0]?.Uri ?? recordings[0]?.RecordingUrl ?? null;
  } catch {
    return null;
  }
}

async function handleEndOfCall(params: URLSearchParams | FormData, callSid: string) {
  const callType      = params.get("CallType")?.toString() ?? "";
  const dialStatus    = params.get("DialCallStatus")?.toString() ?? "";
  const endTime       = params.get("EndTime")?.toString() ?? "";
  const startTime     = params.get("StartTime")?.toString() ?? "";
  const dialDuration  = params.get("DialCallDuration")?.toString() ?? "";
  const recordingUrl  = params.get("RecordingUrl")?.toString() ?? ""; // voicemail only

  // RecordingUrl present for voicemail; for regular calls fetch from Recordings API.
  // A recording only exists when the agent leg actually connected, so fetching it
  // first also gives us the strongest "was it answered" signal.
  const storedUrl = recordingUrl || (await fetchRecordingUrl(callSid));

  // DialCallStatus is the status of the *dialled leg* (the agent for incoming
  // calls, the customer for outbound dials) and DialCallDuration is that leg's
  // talk time — the authoritative answered signal. We do NOT trust CallType:
  // Exotel reports "client-hangup"/"completed" even when the dialled party
  // never picked up (caller hung up while ringing) → that is a MISSED/NO-ANSWER
  // call, not a completed one.
  //
  // Direction is derived from the row so an unanswered call is labelled
  // correctly: "missed" for incoming, "no-answer" for outbound.
  const { data: existing } = await supabaseAdmin
    .from("call_logs")
    .select("from_number")
    .eq("call_sid", callSid)
    .maybeSingle();
  const virtuals = listConfiguredExotelNumbers().map((v) => normalizePhone(v));
  const direction = deriveCallDirection(existing?.from_number, virtuals, phoneMatches);

  const mappedStatus = resolveCallStatus(
    {
      // Prefer the explicit leg status; fall back to CallType only as a hint.
      status: dialStatus || callType,
      duration: dialDuration,
      conversationDuration: dialDuration,
      hasRecording: !!storedUrl,
      legStatus: dialStatus,
    },
    direction
  );

  const updates: Record<string, unknown> = {
    status: mappedStatus,
    updated_at: new Date().toISOString(),
  };

  if (dialDuration) updates.duration_seconds = parseInt(dialDuration, 10) || null;
  if (startTime) {
    try { updates.started_at = new Date(startTime).toISOString(); } catch {}
  }
  if (endTime && endTime !== "1970-01-01 05:30:00") {
    try { updates.ended_at = new Date(endTime).toISOString(); } catch {}
  }

  if (storedUrl) updates.recording_sid = storedUrl;

  console.log("[calls/connect] end-of-call | sid:", callSid, "| callType:", callType,
    "| dialStatus:", dialStatus, "| mapped:", mappedStatus, "| recording:", storedUrl ?? "none");

  await supabaseAdmin
    .from("call_logs")
    .update(updates)
    .eq("call_sid", callSid);
}

type TelephonyAssignee = {
  id: string;
  mobile_phone: string;
};

function paramValue(params: URLSearchParams | FormData, key: string): string {
  const raw = params.get(key);
  if (raw == null) return "";
  return String(raw).trim();
}

/** Exotel: for incoming calls `To` is the ExoPhone; `CallTo` can differ on some flows. */
function extractCalledNumber(params: URLSearchParams | FormData): string {
  const direction = paramValue(params, "Direction").toLowerCase();
  const preferToFirst = direction === "incoming" || direction === "";
  const candidates = preferToFirst
    ? ["To", "CallTo", "DialWhomNumber", "ForwardedFrom"]
    : ["CallTo", "To", "DialWhomNumber"];
  for (const key of candidates) {
    const v = paramValue(params, key);
    if (v) return v;
  }
  return "";
}

/** Team members (mailbox_owner_id set) beat admin accounts sharing the same DID. */
function assigneePriority(row: {
  role?: string | null;
  mailbox_owner_id?: string | null;
}): number {
  if (row.mailbox_owner_id) return 0;
  if (row.role === "staff" || row.role === "committee") return 1;
  return 2;
}

async function findAssigneeByExotelNumber(calledNumber: string): Promise<TelephonyAssignee | null> {
  const calledNorm = normalizePhone(calledNumber);
  if (!calledNorm) return null;

  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("id, mobile_phone, exotel_virtual_number, role, mailbox_owner_id")
    .not("exotel_virtual_number", "is", null)
    .not("mobile_phone", "is", null);

  if (error) {
    if (/exotel_virtual_number|mobile_phone/i.test(error.message ?? "")) {
      console.warn("[calls/connect] telephony columns missing — run migration 0023");
    }
    return null;
  }

  const matches = (data ?? []).filter(
    (p) =>
      p.exotel_virtual_number &&
      p.mobile_phone &&
      phoneMatches(p.exotel_virtual_number as string, calledNorm)
  );

  if (!matches.length) return null;

  if (matches.length > 1) {
    console.warn(
      "[calls/connect] multiple profiles share DID",
      calledNorm,
      "—",
      matches.map((p) => ({
        id: p.id,
        role: p.role,
        mobile: p.mobile_phone,
        team: Boolean(p.mailbox_owner_id),
      }))
    );
  }

  const row = [...matches].sort(
    (a, b) => assigneePriority(a) - assigneePriority(b)
  )[0];

  if (!row?.mobile_phone) return null;
  return { id: row.id as string, mobile_phone: row.mobile_phone as string };
}

async function resolveDestination(
  params: URLSearchParams | FormData,
  callerPhone: string,
  exotelCallSid: string,
  direction: string,
  calledNumber: string
): Promise<{ destination: string; isIncoming: boolean }> {
  const dtmfDigits = params.get("digits")?.toString() ?? params.get("Digits")?.toString() ?? "";
  const defaultUserId = process.env.INCOMING_DEFAULT_USER_ID?.trim() ?? "";

  const callerNormalized = normalizePhone(callerPhone);

  // Step 1: look for a recent pending row this caller created. If one exists,
  // this is definitively an outbound dial (the caller is a registered agent
  // who just placed a call from the app). This check is the source of truth
  // for outbound — it doesn't depend on env-coded agent numbers or on
  // Exotel's Direction header (which has been inconsistent across configs).
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  let pending: { id: string; to_number: string } | null = null;
  if (callerNormalized) {
    const candidates = phoneLookupVariants(callerPhone);
    const { data } = await supabaseAdmin
      .from("call_logs")
      .select("id, to_number, agent_number")
      .eq("status", "pending")
      .gte("created_at", since)
      .in("agent_number", candidates)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) pending = { id: data.id as string, to_number: data.to_number as string };
  }

  if (pending) {
    // OUTBOUND path — caller is an agent dialing through our app
    let destination = pending.to_number ?? "";
    if (!destination && dtmfDigits) {
      destination = dtmfDigits.startsWith("+") ? dtmfDigits : `+91${dtmfDigits}`;
    }
    console.log(
      "[calls/connect] OUTBOUND | caller:",
      callerPhone,
      "| destination:",
      destination,
      "| pending row:",
      pending.id
    );
    if (destination) {
      await supabaseAdmin
        .from("call_logs")
        .update({
          call_sid: exotelCallSid || `exotel_${Date.now()}`,
          agent_number: callerPhone,
          status: "in-progress",
          started_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", pending.id);
    }
    return { destination, isIncoming: false };
  }

  // Step 2: INCOMING — route by which Exotel DID was called (team assignment).
  const assignee = await findAssigneeByExotelNumber(calledNumber);
  let incomingAgent = assignee?.mobile_phone ?? "";
  let logUserId = assignee?.id ?? defaultUserId;

  if (!incomingAgent) {
    const envFallback = process.env.INCOMING_AGENT_NUMBER?.trim() ?? "";
    if (envFallback) {
      console.warn(
        "[calls/connect] no Team assignee for DID",
        calledNumber,
        "— using INCOMING_AGENT_NUMBER env:",
        envFallback,
        "(remove from Vercel once Team Exotel + mobile are set)"
      );
      incomingAgent = envFallback;
    }
    if (!logUserId) logUserId = defaultUserId;
  }

  const incomingAgentNorm = incomingAgent ? normalizePhone(incomingAgent) : "";
  if (incomingAgentNorm && callerNormalized && phoneMatches(incomingAgent, callerPhone)) {
    console.warn(
      "[calls/connect] caller matches route target but has no pending row — refusing self-loop. caller:",
      callerPhone
    );
    return { destination: "", isIncoming: false };
  }

  if (!incomingAgent) {
    console.error(
      "[calls/connect] INCOMING but no agent mobile found. caller:",
      callerPhone,
      "| called DID:",
      calledNumber,
      "| direction:",
      direction,
      "| assignee:",
      assignee?.id ?? "none",
      "— check Admin → Team: assign Exotel line",
      calledNumber,
      "and set personal mobile_phone; add number to EXOTEL_VIRTUAL_NUMBERS on Vercel"
    );
    return { destination: "", isIncoming: true };
  }

  const from = normalizePhone(callerPhone);
  if (logUserId && exotelCallSid) {
    const { data: existing } = await supabaseAdmin
      .from("call_logs")
      .select("id")
      .eq("call_sid", exotelCallSid)
      .maybeSingle();
    if (!existing) {
      await supabaseAdmin.from("call_logs").insert({
        user_id: logUserId,
        call_sid: exotelCallSid,
        to_number: incomingAgent,
        from_number: from,
        agent_number: incomingAgent,
        status: "in-progress",
        started_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    }
  }
  console.log(
    "[calls/connect] INCOMING | from:",
    from,
    "-> mobile:",
    incomingAgent,
    "| called DID:",
    calledNumber,
    "| assignee:",
    assignee?.id ?? "(env fallback)",
    "| sid:",
    exotelCallSid
  );
  return { destination: incomingAgent, isIncoming: true };
}

function buildResponse(destination: string, outgoingPhoneNumber?: string) {
  if (!destination) {
    return NextResponse.json(
      { destination: { numbers: [] } },
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const configured = listConfiguredExotelNumbers();
  const virtualNumber =
    (outgoingPhoneNumber && normalizePhone(outgoingPhoneNumber)) ||
    configured[0] ||
    process.env.EXOTEL_VIRTUAL_NUMBER ||
    "";

  return NextResponse.json(
    {
      fetch_after_attempt: false,
      destination: { numbers: [destination] },
      outgoing_phone_number: virtualNumber,
      record: true,
      recording_channels: "dual",
      max_ringing_duration: 45,
      max_conversation_duration: 3600,
    },
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

// Exotel Programmable Connect uses GET with query params
export async function GET(request: Request) {
  const url = new URL(request.url);
  const callerPhone   = url.searchParams.get("CallFrom") ?? url.searchParams.get("From") ?? "";
  const exotelCallSid = url.searchParams.get("CallSid") ?? "";
  const callType      = url.searchParams.get("CallType") ?? "";
  const direction     = url.searchParams.get("Direction") ?? "";
  const calledNumber  = extractCalledNumber(url.searchParams);

  // Trace every Exotel hit so we can debug from Vercel logs
  const allParams: Record<string, string> = {};
  url.searchParams.forEach((v, k) => { allParams[k] = v; });
  console.log("[calls/connect] GET params:", JSON.stringify(allParams));
  console.log("[calls/connect] env: INCOMING_AGENT_NUMBER=", process.env.INCOMING_AGENT_NUMBER ?? "(unset)", "| INCOMING_DEFAULT_USER_ID set:", Boolean(process.env.INCOMING_DEFAULT_USER_ID));

  // Health check (no Exotel params)
  if (!callerPhone && !exotelCallSid) {
    return NextResponse.json({ status: "Exotel connect webhook is live" });
  }

  // End-of-call hit — CallType is present and is a terminal value
  if (exotelCallSid && TERMINAL_CALL_TYPES.has(callType)) {
    await handleEndOfCall(url.searchParams, exotelCallSid);
    return NextResponse.json({ ok: true });
  }

  const { destination } = await resolveDestination(url.searchParams, callerPhone, exotelCallSid, direction, calledNumber);
  const resp = buildResponse(destination, calledNumber);
  console.log("[calls/connect] returning destination:", destination || "(empty)", "| status:", resp.status);
  return resp;
}

// Some Exotel configs send POST
export async function POST(request: Request) {
  let params: URLSearchParams;
  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const json = await request.json().catch(() => ({}));
    params = new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v)]));
  } else if (ct.includes("application/x-www-form-urlencoded")) {
    params = new URLSearchParams(await request.text());
  } else {
    const form = await request.formData();
    params = new URLSearchParams();
    form.forEach((v, k) => params.set(k, v.toString()));
  }

  const callerPhone   = params.get("CallFrom") ?? params.get("From") ?? "";
  const exotelCallSid = params.get("CallSid") ?? "";
  const callType      = params.get("CallType") ?? "";
  const direction     = params.get("Direction") ?? "";
  const calledNumber  = extractCalledNumber(params);

  if (exotelCallSid && TERMINAL_CALL_TYPES.has(callType)) {
    await handleEndOfCall(params, exotelCallSid);
    return NextResponse.json({ ok: true });
  }

  const { destination } = await resolveDestination(params, callerPhone, exotelCallSid, direction, calledNumber);
  return buildResponse(destination, calledNumber);
}
