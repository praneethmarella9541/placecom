const MEDIA_PLACEHOLDER_RE = /^\[(Image|Video|Audio|Voice|Document|Sticker)\]/i;

export function isWhatsAppMediaPlaceholderBody(body: string | null | undefined): boolean {
  return MEDIA_PLACEHOLDER_RE.test((body ?? "").trim());
}

/** Relative API path the mobile app can load with a Bearer token. */
export function whatsAppMediaProxyPath(params: {
  messageSid?: string | null;
  mediaLink?: string | null;
}): string | null {
  const link = params.mediaLink?.trim();
  if (link?.startsWith("http")) {
    return `/api/whatsapp/media?url=${encodeURIComponent(link)}`;
  }
  const sid = params.messageSid?.trim();
  if (sid) {
    return `/api/whatsapp/media?msgSid=${encodeURIComponent(sid)}`;
  }
  return null;
}

export function messageNeedsWhatsAppMedia(row: {
  body?: string | null;
  num_media?: number | null;
  content_type?: string | null;
}): boolean {
  if ((row.num_media ?? 0) > 0) return true;
  if (isWhatsAppMediaPlaceholderBody(row.body)) return true;
  const ct = (row.content_type ?? "").toLowerCase();
  return ["image", "video", "audio", "document", "sticker"].includes(ct);
}

/** Ensure chat rows always expose a fetchable media_url when we have a message SID. */
export function resolveStoredWhatsAppMediaUrl(row: {
  media_url?: string | null;
  message_sid?: string | null;
  body?: string | null;
  num_media?: number | null;
  content_type?: string | null;
  mediaLink?: string | null;
}): string | null {
  const stored = row.media_url?.trim();
  if (stored) return stored;
  if (!messageNeedsWhatsAppMedia(row)) return null;
  return whatsAppMediaProxyPath({
    messageSid: row.message_sid,
    mediaLink: row.mediaLink,
  });
}
