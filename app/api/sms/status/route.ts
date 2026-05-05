import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getTwilioFromNumber, isTwilioConfigured } from "@/lib/twilio";
import { getTwilioWebhookBaseUrl } from "@/lib/call-recording-url";

export const runtime = "nodejs";

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const base = getTwilioWebhookBaseUrl();
  const suggestedWebhook = base ? `${base}/api/twilio/sms` : null;
  const from = getTwilioFromNumber();

  return NextResponse.json({
    sendConfigured: isTwilioConfigured(),
    fromPreview: from ? "configured" : null,
    suggestedInboundWebhookUrl: suggestedWebhook,
    migrationHint: "Apply supabase/migrations/0014_sms_messages.sql for SMS chat history.",
  });
}
