import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";
import {
  getExotelCredentials,
  getExotelBasicAuthHeader,
  getExotelApiHostCandidates,
} from "@/lib/exotel-config";
import { randomUUID } from "crypto";

export const WHATSAPP_MEDIA_BUCKET = "whatsapp-media";

const MAX_BYTES: Record<string, number> = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 100 * 1024 * 1024,
};

let bucketReady: Promise<void> | null = null;

function ensureBucket(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Promise.resolve();
  }
  if (!bucketReady) {
    bucketReady = (async () => {
      const supabase = createServiceSupabase();
      await supabase.storage.createBucket(WHATSAPP_MEDIA_BUCKET, { public: true });
    })().catch(() => {});
  }
  return bucketReady;
}

export function inferWhatsAppMediaKind(mimeType: string): "image" | "video" | "audio" | "document" {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

export function maxBytesForKind(kind: string): number {
  return MAX_BYTES[kind] ?? MAX_BYTES.document;
}

export async function uploadWhatsAppMedia(params: {
  userId: string;
  file: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ publicUrl: string; kind: "image" | "video" | "audio" | "document" }> {
  await ensureBucket();
  const kind = inferWhatsAppMediaKind(params.mimeType);
  if (params.file.length > maxBytesForKind(kind)) {
    throw new Error(`File too large for WhatsApp ${kind} (max ${Math.round(maxBytesForKind(kind) / 1024 / 1024)} MB).`);
  }

  const safeName = params.filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const objectPath = `${params.userId}/${randomUUID()}-${safeName}`;
  const supabase = createServiceSupabase();
  const { error } = await supabase.storage.from(WHATSAPP_MEDIA_BUCKET).upload(objectPath, params.file, {
    contentType: params.mimeType,
    upsert: false,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(WHATSAPP_MEDIA_BUCKET).getPublicUrl(objectPath);
  const publicUrl = data.publicUrl;
  if (!publicUrl?.startsWith("https://")) {
    throw new Error(
      "Could not get public URL for media. Ensure the whatsapp-media bucket exists and is public in Supabase Storage."
    );
  }
  return { publicUrl, kind };
}

/**
 * Download inbound WhatsApp media from Exotel, then store it in Supabase Storage.
 * Returns the public Supabase URL on success, or null on failure (with a warning log).
 *
 * Exotel may supply either:
 *   • a direct link  (message.image.link)  → fetch without auth
 *   • a media id     (message.image.id)    → fetch via Exotel API with Basic Auth
 *   • a message SID only                  → try the message-media endpoint
 *
 * Tries both Exotel API host regions automatically.
 */
export async function fetchAndStoreExotelMedia(params: {
  mediaLink: string | null;
  mediaId: string | null;
  messageSid: string | null;
  contentType: string | null;
  /** Used to partition the storage path. */
  businessE164: string;
}): Promise<string | null> {
  const { mediaLink, mediaId, messageSid, businessE164 } = params;
  const mimeType = params.contentType?.trim() || "application/octet-stream";

  let buffer: Buffer | null = null;

  // ── 1. Direct CDN link ──────────────────────────────────────────────────
  if (mediaLink) {
    try {
      const res = await fetch(mediaLink);
      if (res.ok) buffer = Buffer.from(await res.arrayBuffer());
    } catch (e) {
      console.warn("[fetchAndStoreExotelMedia] direct link fetch failed:", e);
    }
  }

  // ── 2. Exotel media API (try by mediaId then by messageSid) ────────────
  if (!buffer) {
    const creds = getExotelCredentials();
    if (creds) {
      const auth = getExotelBasicAuthHeader(creds);
      const hosts = getExotelApiHostCandidates();

      // Build candidate fetch URLs — try most-specific first.
      const candidates: string[] = [];
      if (mediaId) {
        for (const h of hosts) {
          candidates.push(`https://${h}/v2/accounts/${creds.sid}/media/${mediaId}`);
        }
      }
      if (messageSid) {
        for (const h of hosts) {
          candidates.push(`https://${h}/v2/accounts/${creds.sid}/messages/${messageSid}/media/0`);
        }
      }

      for (const url of candidates) {
        try {
          const res = await fetch(url, { headers: { Authorization: auth } });
          if (res.ok) {
            buffer = Buffer.from(await res.arrayBuffer());
            break;
          }
          console.warn("[fetchAndStoreExotelMedia] Exotel media fetch →", url, "→", res.status);
        } catch (e) {
          console.warn("[fetchAndStoreExotelMedia] fetch error:", url, e);
        }
      }
    }
  }

  if (!buffer || buffer.length === 0) {
    console.warn("[fetchAndStoreExotelMedia] could not download media; no URL stored");
    return null;
  }

  try {
    const ext = mimeType.split("/")[1]?.replace(/\+.*/, "") || "bin";
    const filename = `inbound.${ext}`;
    const { publicUrl } = await uploadWhatsAppMedia({
      userId: businessE164.replace(/\D/g, ""),
      file: buffer,
      filename,
      mimeType,
    });
    return publicUrl;
  } catch (e) {
    console.warn("[fetchAndStoreExotelMedia] Supabase upload failed:", e);
    return null;
  }
}
