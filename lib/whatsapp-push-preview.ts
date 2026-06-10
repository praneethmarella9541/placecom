const MEDIA_PLACEHOLDER_RE =
  /^\[(Image|Video|Audio|Voice|Document|Sticker|Location|GIF)\](?::\s*(.+))?$/i;

function isMediaPlaceholder(body: string): boolean {
  return MEDIA_PLACEHOLDER_RE.test(body.trim());
}

/** WhatsApp-style notification line for inbound message alerts. */
export function formatWhatsAppPushPreview(params: {
  body?: string | null;
  contentType?: string | null;
  numMedia?: number | null;
}): string {
  const raw = (params.body ?? "").trim();
  const caption = raw && !isMediaPlaceholder(raw) ? raw : "";
  const placeholder = raw.match(MEDIA_PLACEHOLDER_RE);
  const ct = (params.contentType ?? "").toLowerCase();
  const hasMedia = (params.numMedia ?? 0) > 0 || !!placeholder;

  if (caption && !hasMedia) return caption;

  const kindFromCt = ct.startsWith("image/")
    ? "image"
    : ct.startsWith("video/")
      ? "video"
      : ct.startsWith("audio/")
        ? "audio"
        : ct === "sticker"
          ? "sticker"
          : ct.startsWith("application/") || ct.includes("document")
            ? "document"
            : null;

  const kindFromBody = placeholder?.[1]?.toLowerCase();
  const kind = kindFromCt ?? kindFromBody ?? (hasMedia ? "image" : null);

  if (kind === "image" || raw === "[Image]") {
    return caption || "Photo";
  }
  if (kind === "video" || raw === "[Video]") {
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
    const name = placeholder?.[2]?.trim() || raw.replace(/^\[Document:\s*/i, "").replace(/\]$/, "");
    return name ? `Document · ${name}` : "Document";
  }
  if (raw === "[Location]") {
    return "Location";
  }

  if (caption) return caption;
  if (raw) return raw;
  return "New message";
}
