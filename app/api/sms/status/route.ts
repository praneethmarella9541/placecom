import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getWebhookBaseUrl } from "@/lib/call-recording-url";
import { getExotelApiHost, isExotelSmsConfigured } from "@/lib/exotel-sms";
import { getUserSmsLine } from "@/lib/sms-telephony";

export const runtime = "nodejs";

/** Status for the SMS UI: Exotel send + the user's assigned ExoPhone (no secrets). */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const lineResult = await getUserSmsLine(supabase, user.id);
  const businessLine = lineResult.ok ? lineResult.line : null;
  const lineError = lineResult.ok ? null : lineResult.error;

  const base = getWebhookBaseUrl();
  const inboundWebhook = base ? `${base}/api/exotel/sms` : null;
  const statusWebhook = base ? `${base}/api/exotel/sms/status` : null;

  return NextResponse.json({
    provider: "exotel",
    sendConfigured: isExotelSmsConfigured(),
    apiHost: getExotelApiHost(),
    businessLine,
    lineError,
    fromPreview: businessLine ? businessLine : null,
    suggestedInboundWebhookUrl: inboundWebhook,
    suggestedStatusWebhookUrl: statusWebhook,
    migrationHint:
      "Apply migrations 0018_sms_messages.sql, 0023_profile_telephony.sql and 0031_sms_business_line.sql for Exotel SMS threads scoped per assigned number.",
  });
}
