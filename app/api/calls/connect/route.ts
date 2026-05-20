import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET() {
  return NextResponse.json({ status: "Exotel connect webhook is live" });
}

export async function POST(request: Request) {
  const form = await request.formData();
  const callerPhone   = form.get("From")?.toString() ?? "";
  const exotelCallSid = form.get("CallSid")?.toString() ?? "";
  const dtmfDigits    = form.get("digits")?.toString() ?? form.get("Digits")?.toString() ?? "";

  const since = new Date(Date.now() - 10 * 60 * 1000).toISOString();

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

  if (!destination) {
    console.error("[calls/connect] No destination found — pending:", pending, "dtmf:", dtmfDigits);
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`,
      { status: 200, headers: { "Content-Type": "text/xml" } }
    );
  }

  if (pending) {
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

  // Exotel requires ExoML XML — JSON is ignored and the call gets dropped
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Number>${destination}</Number>
  </Dial>
</Response>`;

  return new NextResponse(xml, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}
