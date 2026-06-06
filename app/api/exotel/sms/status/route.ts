import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Exotel SMS StatusCallback (DLR). On a terminal state Exotel POSTs:
 * SmsSid, To, Status (sent | failed | failed-dnd), DetailedStatus, DetailedStatusCode.
 * We update the matching outbound row's delivery_status so the UI can show failures.
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
  const sid = (params.get("SmsSid") || params.get("MessageSid") || params.get("sid") || "").trim();
  const status = (params.get("Status") || params.get("status") || "").trim().toLowerCase();
  const detail = (params.get("DetailedStatus") || params.get("DetailedStatusCode") || "").trim();

  if (!sid || !status) {
    return NextResponse.json({ ok: true, skipped: "missing SmsSid/Status" });
  }

  const deliveryStatus =
    status.startsWith("failed") && detail ? `${status}: ${detail.slice(0, 240)}` : status;

  try {
    const supabase = createServiceSupabase();
    const { error } = await supabase
      .from("sms_messages")
      .update({ delivery_status: deliveryStatus })
      .eq("message_sid", sid);
    if (error && !error.message.includes("does not exist")) {
      console.warn("[exotel/sms/status] update:", error.message);
    }
  } catch {
    console.warn("[exotel/sms/status] SUPABASE_SERVICE_ROLE_KEY missing; DLR not applied");
  }

  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!url.searchParams.get("SmsSid") && !url.searchParams.get("sid")) {
    return NextResponse.json({ status: "Exotel SMS status callback is live" });
  }
  return handle(request);
}
