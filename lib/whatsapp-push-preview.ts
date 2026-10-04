const MEDIA_PLACEHOLDER_RE =
  /^\[(Image|Video|Audio|Voice|Document|Sticker|Location|GIF|Attachment)\](?::\s*(.+))?$/i;

function isMediaPlaceholder(body: string): boolean {
  return MEDIA_PLACEHOLDER_RE.test(body.trim());
}

function mediaKind(params: {
  messageType?: string | null;
  contentType?: string | null;
  body?: string | null;
  numMedia?: number | null;
}): string | null {
  const mt = (params.messageType ?? "").toLowerCase();
  if (mt === "image") return "image";
  if (mt === "video") return "video";
  if (mt === "audio") return "audio";
  if (mt === "document") return "document";
  if (mt === "sticker") return "sticker";
  if (mt === "location") return "location";

  const ct = (params.contentType ?? "").toLowerCase();
  if (ct.startsWith("image/")) return "image";
  if (ct.startsWith("video/")) return "video";
  if (ct.startsWith("audio/")) return "audio";
  if (ct === "sticker") return "sticker";
  if (ct.startsWith("application/") || ct.includes("document") || ct.includes("pdf")) {
    return "document";
  }

  const raw = (params.body ?? "").trim();
  const placeholder = raw.match(MEDIA_PLACEHOLDER_RE);
  if (placeholder?.[1]) return placeholder[1].toLowerCase();

  if ((params.numMedia ?? 0) > 0) return "image";
  return null;
}

/** True when the push payload should include a rich image attachment. */
export function whatsAppPushRichImageUrl(params: {
  mediaUrl?: string | null;
  messageType?: string | null;
  contentType?: string | null;
}): string | null {
  const url = params.mediaUrl?.trim();
  if (!url || !/^https?:\/\//i.test(url)) return null;

  const kind = mediaKind({
    messageType: params.messageType,
    contentType: params.contentType,
  });
  if (kind === "image" || kind === "sticker") return url;
  if (params.contentType?.toLowerCase().startsWith("image/")) return url;
  return null;
}

/** WhatsApp-style notification line for inbound message alerts. */
export function formatWhatsAppPushPreview(params: {
  body?: string | null;
  contentType?: string | null;
  numMedia?: number | null;
  messageType?: string | null;
  /** When true and media is an image, omit generic "Photo" — the thumbnail carries the message. */
  hasRichImage?: boolean;
}): string {
  const raw = (params.body ?? "").trim();
  const caption = raw && !isMediaPlaceholder(raw) ? raw : "";
  const placeholder = raw.match(MEDIA_PLACEHOLDER_RE);
  const hasMedia = (params.numMedia ?? 0) > 0 || !!placeholder;

  if (caption && !hasMedia) return caption;

  const kind = mediaKind({
    messageType: params.messageType,
    contentType: params.contentType,
    body: raw,
    numMedia: params.numMedia,
  });

  if (kind === "image") {
    if (caption) return caption;
    return params.hasRichImage ? "" : "Photo";
  }
  if (kind === "video") {
    return caption || "Video";
  }
  if (kind === "audio" || raw === "[Voice]") {
    return caption || "Voice message";
  }
  if (raw === "[Audio]") {
    return caption || "Audio";
  }
  if (kind === "sticker" || raw === "[Sticker]") {
    return "Sticker";
  }
  if (kind === "document" || raw.startsWith("[Document")) {
    const name =
      placeholder?.[2]?.trim() ||
      raw.replace(/^\[Document:\s*/i, "").replace(/\]$/, "");
    return name ? `Document · ${name}` : "Document";
  }
  if (kind === "location" || raw === "[Location]") {
    return "Location";
  }

  if (caption) return caption;
  if (raw && !isMediaPlaceholder(raw)) return raw;
  return "New message";
}
