import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getWebhookBaseUrl } from "@/lib/call-recording-url";
import { getExotelApiHost } from "@/lib/exotel-config";
import {
  getDefaultWhatsAppTemplate,
  formatTemplatePreview,
  serializeTemplatesForClient,
} from "@/lib/whatsapp-template";
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
  const template = getDefaultWhatsAppTemplate();

  return NextResponse.json({
    provider: "exotel",
    sendConfigured: isExotelWhatsAppConfigured(),
    apiHost: getExotelApiHost(),
    businessLine,
    lineError,
    fromPreview: businessLine ? businessLine : null,
    suggestedInboundWebhookUrl: suggestedWebhook,
    templates: serializeTemplatesForClient().map((t) => ({
      ...t,
      previewExample: formatTemplatePreview(t, Array.from(
        { length: t.bodyParamCount },
        (_, i) => (i === 0 ? "Customer" : i === 1 ? "Your name" : `Value ${i + 1}`)
      )),
    })),
    defaultTemplate: {
      name: template.name,
      languageCode: template.languageCode,
      bodyParamCount: template.bodyParamCount,
      label: template.label,
      previewExample: formatTemplatePreview(template, ["Customer", "Your name"]),
    },
    features: listWhatsAppFeatures(),
    deliveryHint:
      "A row in Supabase only means Exotel accepted the message. Delivery requires Meta/WhatsApp approval. Failed sends update delivery_status via the same webhook URL (status callbacks / DLR). Check Exotel → WhatsApp message logs for error codes (e.g. 131021 not on WhatsApp, marketing template without opt-in).",
    migrationHint:
      "Apply migrations 0016, 0017, 0023, 0024, and 0025. Configure incoming + status webhooks to https://YOUR_HOST/api/exotel/whatsapp",
  });
}
