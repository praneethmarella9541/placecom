import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getTwilioWebhookBaseUrl } from "@/lib/call-recording-url";
import {
  getExotelWhatsAppWebhookUrl,
  isExotelWhatsAppConfigured,
} from "@/lib/exotel-whatsapp";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";

export const runtime = "nodejs";

/** Status for UI: Exotel send + user's assigned business line (no secrets). */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const lineResult = await getUserWhatsAppLine(supabase, user.id);
  const businessLine = lineResult.ok ? lineResult.data.line : null;
  const lineError = lineResult.ok ? null : lineResult.error;

  const base = getTwilioWebhookBaseUrl();
  const suggestedWebhook = getExotelWhatsAppWebhookUrl() ?? (base ? `${base}/api/exotel/whatsapp` : null);

  return NextResponse.json({
    provider: "exotel",
    sendConfigured: isExotelWhatsAppConfigured(),
    businessLine,
    lineError,
    fromPreview: businessLine ? businessLine : null,
    suggestedInboundWebhookUrl: suggestedWebhook,
    migrationHint:
      "Apply 0016_whatsapp_messages.sql, 0017_whatsapp_message_actions.sql, 0023_profile_telephony.sql, and 0024_whatsapp_business_line.sql. Configure the webhook URL in Exotel Dashboard → WhatsApp → Webhooks.",
  });
}
