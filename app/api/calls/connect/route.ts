import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function resolveDestination(params: URLSearchParams | FormData, callerPhone: string, exotelCallSid: string) {
  const dtmfDigits = params.get("digits")?.toString() ?? params.get("Digits")?.toString() ?? "";

  // 3-minute window — recent pending row
  const since = new Date(Date.now() - 3 * 60 * 1000).toISOString();

  const { data: pending } = await supabaseAdmin
    .from("call_logs")
    .select("id, to_number")
    .eq("status", "pending")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let destination = pending?.to_number ?? "";

  if (!destination && dtmfDigits) {
    destination = dtmfDigits.startsWith("+") ? dtmfDigits : `+91${dtmfDigits}`;
  }

  console.log("[calls/connect] caller:", callerPhone, "| destination:", destination, "| pending row:", pending?.id ?? "none");

  // Mark in-progress
  if (destination && pending) {
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

  return destination;
}

function buildResponse(destination: string) {
  if (!destination) {
    // No destination — empty destination array, Exotel will fall through
    return NextResponse.json(
      { destination: { numbers: [] } },
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  const virtualNumber = process.env.EXOTEL_VIRTUAL_NUMBER ?? "+919513886363";

  return NextResponse.json(
    {
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

  // Health check (no Exotel params)
  if (!callerPhone && !exotelCallSid) {
    return NextResponse.json({ status: "Exotel connect webhook is live" });
  }

  const destination = await resolveDestination(url.searchParams, callerPhone, exotelCallSid);
  return buildResponse(destination);
}

// Some Exotel configs send POST — keep it for safety
export async function POST(request: Request) {
  const form = await request.formData();
  const callerPhone   = form.get("CallFrom")?.toString() ?? form.get("From")?.toString() ?? "";
  const exotelCallSid = form.get("CallSid")?.toString() ?? "";

  const destination = await resolveDestination(form, callerPhone, exotelCallSid);
  return buildResponse(destination);
}
