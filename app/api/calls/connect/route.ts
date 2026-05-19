import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

// Service role client — no user session in a webhook
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

  // Find the most recent pending call registered in the last 5 minutes
  const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();

  const { data: pending } = await supabaseAdmin
    .from("call_logs")
    .select("id, to_number")
    .eq("status", "pending")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!pending) {
    return NextResponse.json({ error: "No pending call found" }, { status: 404 });
  }

  // Update the log with Exotel's real call SID and agent's number
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

  // Return destination number to Exotel
  return NextResponse.json({ to: pending.to_number });
}
