import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getWebhookBaseUrl } from "@/lib/call-recording-url";
import { getExotelApiHost } from "@/lib/exotel-config";
import { formatTemplatePreview } from "@/lib/whatsapp-template";
import { getWhatsAppTemplatesResolved } from "@/lib/whatsapp-template-resolve";
import {
  getExotelWhatsAppWebhookUrl,
  isExotelWhatsAppConfigured,
} from "@/lib/exotel-whatsapp";
import { listWhatsAppFeatures } from "@/lib/whatsapp-capabilities";
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

  const base = getWebhookBaseUrl();
  const suggestedWebhook = getExotelWhatsAppWebhookUrl() ?? (base ? `${base}/api/exotel/whatsapp` : null);
  const templates = await getWhatsAppTemplatesResolved();
  const template = templates[0]!;

  return NextResponse.json({
    provider: "exotel",
    sendConfigured: isExotelWhatsAppConfigured(),
    apiHost: getExotelApiHost(),
    businessLine,
    lineError,
    fromPreview: businessLine ? businessLine : null,
    suggestedInboundWebhookUrl: suggestedWebhook,
    suggestedStatusWebhookUrl: suggestedWebhook,
    templates: templates.map((t) => ({
      ...t,
      previewExample: formatTemplatePreview(t, Array.from(
        { length: t.bodyParamCount },
        (_, i) => (i === 0 ? "Customer" : i === 1 ? "Your name" : `Value ${i + 1}`)
      )),
    })),
    exotelTemplateSync: Boolean(process.env.EXOTEL_API_KEY?.trim() && process.env.EXOTEL_API_TOKEN?.trim()),
    defaultTemplate: {
      name: template.name,
      languageCode: template.languageCode,
      bodyParamCount: template.bodyParamCount,
      label: template.label,
      previewExample: formatTemplatePreview(template, ["Customer", "Your name"]),
    },
    features: listWhatsAppFeatures(),
    deliveryHint:
      "Grey double ticks = delivered, blue = read. Updates come from Exotel status callbacks to the same webhook URL. In Exotel Dashboard → WhatsApp → Webhooks, set both incoming_message_url and status_callback_url to https://YOUR_HOST/api/exotel/whatsapp (or rely on per-message status_callback from send). Read receipts only appear when the recipient has read receipts enabled and opens the chat.",
    migrationHint:
      "Apply migrations 0016, 0017, 0023, 0024, and 0025. Configure incoming + status webhooks to https://YOUR_HOST/api/exotel/whatsapp",
  });
}
