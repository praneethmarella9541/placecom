import { isWhatsAppMediaPlaceholderBody } from "@/lib/whatsapp-media-resolve";

export type WhatsAppMediaCategory = "image" | "video" | "audio" | "document";

type MediaMessage = {
  body?: string | null;
  media_url?: string | null;
  content_type?: string | null;
  num_media?: number | null;
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

export function mediaFilenameFromMessage(message: MediaMessage): string {
  const url = message.media_url ?? "";
  const fromUrl = url.split("/").pop()?.split("?")[0];
  if (fromUrl && fromUrl.includes(".")) return decodeURIComponent(fromUrl);

  const body = message.body?.trim() ?? "";
  if (body && !isWhatsAppMediaPlaceholderBody(body) && !body.startsWith("[")) {
    return body.slice(0, 120);
  }

  const cat = categorizeWhatsAppMedia(message);
  if (cat === "image") return "image.jpg";
  if (cat === "video") return "video.mp4";
  if (cat === "audio") return "audio.m4a";
  return "document.pdf";
}
