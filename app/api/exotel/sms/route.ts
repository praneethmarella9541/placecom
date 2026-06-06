import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { resolveBusinessE164FromWebhook } from "@/lib/exotel-webhook-parse";
import { findUserIdForSmsLine } from "@/lib/sms-telephony";
import { normalizePeerE164 } from "@/lib/whatsapp-address";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exotel inbound SMS.
 *
 * In the Exotel Dashboard → ExoPhone → SMS, point the incoming-SMS webhook to
 * POST {EXOTEL_WEBHOOK_BASE_URL}/api/exotel/sms. Exotel posts From/To/Body/SmsSid
 * (form-urlencoded or query string). `To` is the ExoPhone (the business line);
 * `From` is the contact (peer). We resolve the owning team member by the line so
 * the thread lands in the right person's inbox.
 */
async function parseParams(request: Request): Promise<URLSearchParams> {
  const url = new URL(request.url);
  if (request.method === "GET") return url.searchParams;

  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const json = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return new URLSearchParams(Object.entries(json).map(([k, v]) => [k, String(v ?? "")]));
  }
  if (ct.includes("application/x-www-form-urlencoded")) {
    return new URLSearchParams(await request.text());
  }
  try {
    const form = await request.formData();
    const params = new URLSearchParams();
    form.forEach((v, k) => params.set(k, v.toString()));
    return params;
  } catch {
    return url.searchParams;
  }
}

async function handle(request: Request): Promise<NextResponse> {
  const params = await parseParams(request);

  const messageSid = (params.get("SmsSid") || params.get("MessageSid") || params.get("sid") || "").trim();
  const from = (params.get("From") || params.get("from") || "").trim();
  const to = (params.get("To") || params.get("to") || "").trim();
  const rawBody = params.get("Body") ?? params.get("body") ?? "";

  if (!messageSid || !from || !to) {
    return NextResponse.json({ ok: true, skipped: "missing From/To/SmsSid" });
  }

  let supabase;
  try {
    supabase = createServiceSupabase();
  } catch {
    console.warn("[exotel/sms] SUPABASE_SERVICE_ROLE_KEY missing; inbound SMS not stored");
    return NextResponse.json({ ok: true, skipped: "service role missing" });
  }

  const businessE164 = await resolveBusinessE164FromWebhook(to);
  if (!businessE164) {
    console.warn("[exotel/sms] could not resolve business line for To:", to, "| From:", from);
    return NextResponse.json({ ok: true, skipped: "unknown business line" });
  }

  const ownerId = await findUserIdForSmsLine(businessE164);
  const peer = normalizePeerE164(from);
  const displayBody = rawBody.trim() || null;

  const { error } = await supabase.from("sms_messages").insert({
    user_id: ownerId,
    direction: "inbound",
    peer_e164: peer,
    business_e164: businessE164,
    from_addr: from,
    to_addr: to,
    body: displayBody,
    message_sid: messageSid,
  });

  if (error) {
    const code = (error as { code?: string }).code;
    if (code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true });
    }
    if (error.message.includes("does not exist") || code === "42P01") {
      console.warn("[exotel/sms] sms_messages table missing:", error.message);
      return NextResponse.json({ ok: true, skipped: "table missing" });
    }
    console.error("[exotel/sms] insert error:", error);
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  return handle(request);
}

// Some Exotel SMS applets call the URL with GET query params.
export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!url.searchParams.get("From") && !url.searchParams.get("from")) {
    return NextResponse.json({ status: "Exotel inbound SMS webhook is live" });
  }
  return handle(request);
}
