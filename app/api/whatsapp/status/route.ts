import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { getWhatsAppFromAddress, isWhatsAppSandbox, isWhatsAppSendConfigured } from "@/lib/whatsapp";
import { getTwilioWebhookBaseUrl } from "@/lib/call-recording-url";

export const runtime = "nodejs";

/** Public-ish status for UI: whether send + DB are likely to work (no secrets). */
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
  const suggestedWebhook = base ? `${base}/api/twilio/whatsapp` : null;

  return NextResponse.json({
    sendConfigured: isWhatsAppSendConfigured(),
    sandbox: isWhatsAppSandbox(),
    fromPreview: getWhatsAppFromAddress() ? "configured" : null,
    suggestedInboundWebhookUrl: suggestedWebhook,
    migrationHint:
      "Apply supabase/migrations/0012_whatsapp_messages.sql and 0013_whatsapp_message_actions.sql for message history and actions.",
  });
}
