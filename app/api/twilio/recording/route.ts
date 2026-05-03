import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import twilio from "twilio";
import { getTwilioClient } from "@/lib/twilio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function formToParams(form: FormData): Record<string, string> {
  const params: Record<string, string> = {};
  form.forEach((value, key) => {
    if (typeof value === "string") params[key] = value;
  });
  return params;
}

export async function POST(request: Request) {
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!authToken || !supabaseUrl || !serviceKey) {
    return new NextResponse("Server misconfigured", { status: 500 });
  }

  const signature = request.headers.get("X-Twilio-Signature") || "";
  const form = await request.formData();
  const params = formToParams(form);

  const requestUrl = request.url;
  const ok = twilio.validateRequest(authToken, signature, requestUrl, params);
  if (!ok) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const recordingSid = params.RecordingSid?.trim();
  const callSid = params.CallSid?.trim();
  const durationRaw = params.RecordingDuration?.trim();
  const duration = durationRaw ? Number.parseInt(durationRaw, 10) : null;

  if (!recordingSid || !callSid) {
    return new NextResponse("OK", { status: 200 });
  }

  const supabase = createClient(supabaseUrl, serviceKey);

  const patch = {
    recording_sid: recordingSid,
    recording_duration_seconds: Number.isFinite(duration) ? duration : null,
    updated_at: new Date().toISOString(),
  };

  const { data: direct, error: e1 } = await supabase
    .from("call_logs")
    .update(patch)
    .eq("call_sid", callSid)
    .select("id");

  if (!e1 && direct && direct.length > 0) {
    return new NextResponse("OK", { status: 200 });
  }

  const client = getTwilioClient();
  if (!client) {
    return new NextResponse("OK", { status: 200 });
  }

  try {
    const call = await client.calls(callSid).fetch();
    const parentSid = call.parentCallSid?.trim();
    if (parentSid) {
      const { data: viaParent } = await supabase
        .from("call_logs")
        .update(patch)
        .eq("call_sid", parentSid)
        .select("id");
      if (viaParent && viaParent.length > 0) {
        return new NextResponse("OK", { status: 200 });
      }
    }
  } catch {
    // best effort
  }

  return new NextResponse("OK", { status: 200 });
}
