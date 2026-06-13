import "server-only";

import { getWebhookBaseUrl, getWebhookBaseUrlFromRequest } from "@/lib/call-recording-url";
import { downloadExotelWhatsAppMedia, uploadWhatsAppMedia } from "@/lib/whatsapp-media-storage";

function absoluteMediaUrl(mediaUrl: string, base: string | null): string {
  const trimmed = mediaUrl.trim();
  if (trimmed.startsWith("https://")) return trimmed;
  if (trimmed.startsWith("http://")) return trimmed;
  if (trimmed.startsWith("/") && base) return `${base}${trimmed}`;
  return trimmed;
}

function parseOwnMediaProxy(url: string): { msgSid: string | null; directUrl: string | null } | null {
  try {
    const parsed = url.startsWith("http")
      ? new URL(url)
      : new URL(url, "https://placeholder.local");
    if (!parsed.pathname.endsWith("/api/whatsapp/media")) return null;
    return {
      msgSid: parsed.searchParams.get("msgSid")?.trim() || null,
      directUrl: parsed.searchParams.get("url")?.trim() || null,
    };
  } catch {
    return null;
  }
}

/** Ensure outbound media is a public HTTPS URL Exotel can fetch. */
export async function resolveOutboundMediaUrl(params: {
  mediaUrl: string;
  userId: string;
  request?: Request;
}): Promise<string> {
  const base = params.request
    ? getWebhookBaseUrlFromRequest(params.request)
    : getWebhookBaseUrl();
  const absolute = absoluteMediaUrl(params.mediaUrl, base);

  if (absolute.includes("/api/whatsapp/serve-media")) {
    if (!absolute.startsWith("https://")) {
      throw new Error(
        "App URL is not configured for WhatsApp media delivery. Set NEXT_PUBLIC_APP_URL or EXOTEL_WEBHOOK_BASE_URL."
      );
    }
    return absolute;
  }

  const proxy = parseOwnMediaProxy(absolute);
  if (proxy) {
    const downloaded = await downloadExotelWhatsAppMedia({
      mediaLink: proxy.directUrl,
      mediaId: null,
      messageSid: proxy.msgSid,
    });
    if (!downloaded?.buffer.length) {
      throw new Error("Media URL is not available for forwarding.");
    }
    const ext = downloaded.contentType.split("/")[1]?.replace(/\+.*/, "") || "bin";
    const { publicUrl } = await uploadWhatsAppMedia({
      userId: params.userId,
      file: downloaded.buffer,
      filename: `forward.${ext}`,
      mimeType: downloaded.contentType,
      publicBaseUrl: base,
    });
    return publicUrl;
  }

  if (!absolute.startsWith("https://")) {
    throw new Error("Media messages require an HTTPS URL (upload the file first).");
  }
  return absolute;
}
