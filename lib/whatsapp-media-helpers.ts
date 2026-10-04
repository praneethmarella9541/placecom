import { isWhatsAppMediaPlaceholderBody } from "@/lib/whatsapp-media-resolve";

export type WhatsAppMediaCategory = "image" | "video" | "audio" | "document";

type MediaMessage = {
  body?: string | null;
  media_url?: string | null;
  content_type?: string | null;
  num_media?: number | null;
  media_filename?: string | null;
};

function isImageMessage(message: MediaMessage): boolean {
  if (!message.media_url) return false;
  const ct = (message.content_type ?? "").toLowerCase();
  if (ct === "image" || ct.startsWith("image/")) return true;
  const body = (message.body ?? "").trim();
  return /^\[image/i.test(body);
}

function isVideoMessage(message: MediaMessage): boolean {
  if (!message.media_url) return false;
  const ct = (message.content_type ?? "").toLowerCase();
  if (ct === "video" || ct.startsWith("video/")) return true;
  const body = (message.body ?? "").trim();
  return /^\[video/i.test(body);
}

function isAudioMessage(message: MediaMessage): boolean {
  if (!message.media_url) return false;
  const ct = (message.content_type ?? "").toLowerCase();
  if (ct === "audio" || ct.startsWith("audio/")) return true;
  const body = (message.body ?? "").trim();
  return /^\[(audio|voice)/i.test(body);
}

export function categorizeWhatsAppMedia(message: MediaMessage): WhatsAppMediaCategory | null {
  if (!message.media_url) return null;
  if (isImageMessage(message)) return "image";
  if (isVideoMessage(message)) return "video";
  if (isAudioMessage(message)) return "audio";
  return "document";
}

export type MediaListPreviewKind = "photo" | "video" | "audio" | "sticker" | "document" | "location";

/**
 * WhatsApp-style icon-kind + label for a conversation-list preview whose last
 * message is media with no caption (body is just the "[Image]"-style system
 * placeholder written at send/receive time — see whatsapp-outbound-content.ts
 * and exotel-webhook-parse.ts) — mirrors how WhatsApp itself shows
 * "📷 Photo" / "📄 filename" in the chat list instead of raw brackets.
 * Returns only the *kind*, not an icon — callers own their own icon set.
 */
export function mediaListPreview(body: string | null): { kind: MediaListPreviewKind; label: string } | null {
  if (!body) return null;
  const trimmed = body.trim();
  const doc = /^\[Document(?::\s*(.+))?\]$/i.exec(trimmed);
  if (doc) return { kind: "document", label: doc[1]?.trim() || "Document" };
  if (/^\[Location\]/i.test(trimmed)) return { kind: "location", label: "Location" };
  switch (trimmed.toLowerCase()) {
    case "[image]":
      return { kind: "photo", label: "Photo" };
    case "[video]":
      return { kind: "video", label: "Video" };
    case "[audio]":
      return { kind: "audio", label: "Audio" };
    case "[sticker]":
      return { kind: "sticker", label: "Sticker" };
    default:
      return null;
  }
}

export function mediaFilenameFromMessage(message: MediaMessage): string {
  const stored = message.media_filename?.trim();
  if (stored) return stored;

  const body = message.body?.trim() ?? "";
  const docMatch = body.match(/^\[Document:\s*(.+)\]$/i);
  if (docMatch?.[1]?.trim()) return docMatch[1].trim();

  const url = message.media_url ?? "";
  try {
    const parsed = new URL(url, "https://local");
    const storagePath = parsed.searchParams.get("p");
    if (storagePath) {
      const fromStorage = filenameFromStoragePath(storagePath);
      if (fromStorage && !isCacheLikeUploadFilename(fromStorage)) return fromStorage;
    }
  } catch {
    /* ignore */
  }

  const fromUrl = url.split("/").pop()?.split("?")[0];
  if (fromUrl && fromUrl.includes(".") && fromUrl !== "serve-media") {
    const decoded = decodeURIComponent(fromUrl);
    if (!isCacheLikeUploadFilename(decoded)) return decoded;
  }

  if (body && !isWhatsAppMediaPlaceholderBody(body) && !body.startsWith("[")) {
    return body.slice(0, 120);
  }

  const cat = categorizeWhatsAppMedia(message);
  if (cat === "image") return "image.jpg";
  if (cat === "video") return "video.mp4";
  if (cat === "audio") return "audio.m4a";
  return "document.pdf";
}

const UUID_PREFIX_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i;

function filenameFromStoragePath(objectPath: string): string | null {
  const segment = decodeURIComponent(objectPath).split("/").pop()?.trim();
  if (!segment) return null;
  const withoutUuid = segment.replace(UUID_PREFIX_RE, "");
  return withoutUuid.includes(".") ? withoutUuid : null;
}

function isCacheLikeUploadFilename(name: string): boolean {
  const n = name.trim();
  if (!n || n === "upload") return true;
  if (/^(file|document|audio|photo|video|image)(-\d+)?(\.[a-z0-9]+)?$/i.test(n)) return true;
  if (/^[0-9a-f]{8,}(\.[a-z0-9]+)?$/i.test(n)) return true;
  if (/^\d+(\.[a-z0-9]+)?$/i.test(n)) return true;
  return false;
}
