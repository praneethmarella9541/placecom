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
 * Walk the nested Exotel message JSON response to find a downloadable media URL.
 * Exotel's message GET response wraps content differently across API versions.
 */
function extractMediaUrlFromExotelMessage(json: Record<string, unknown>): string | null {
  // Helper: recursively search for a URL-like string at known field names.
  function dig(obj: unknown, depth = 0): string | null {
    if (!obj || typeof obj !== "object" || depth > 6) return null;
    const o = obj as Record<string, unknown>;
    // Direct URL fields.
    for (const key of ["link", "url", "media_url", "download_url", "file_url", "media_link"]) {
      const v = String(o[key] ?? "").trim();
      if (v.startsWith("http")) return v;
    }
    // Recurse into nested objects / arrays.
    for (const val of Object.values(o)) {
      if (Array.isArray(val)) {
        for (const item of val) { const r = dig(item, depth + 1); if (r) return r; }
      } else if (val && typeof val === "object") {
        const r = dig(val, depth + 1); if (r) return r;
      }
    }
    return null;
  }
  return dig(json);
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

  // ── 2. Exotel media API ─────────────────────────────────────────────────
  // Exotel's webhook doesn't include the media URL/ID in the payload.
  // Strategy:
  //   a) GET the message record — Exotel returns the full message including
  //      a media download URL in the content block.
  //   b) Fall back to direct media sub-resource endpoints.
  if (!buffer && messageSid) {
    const creds = getExotelCredentials();
    if (creds) {
      const auth = getExotelBasicAuthHeader(creds);
      const hosts = getExotelApiHostCandidates();

      // a) Fetch the message record and extract the media URL from it.
      for (const h of hosts) {
        const msgUrl = `https://${h}/v2/accounts/${creds.sid}/messages/${messageSid}`;
        try {
          const res = await fetch(msgUrl, { headers: { Authorization: auth } });
          if (res.ok) {
            const json = await res.json() as Record<string, unknown>;
            console.log("[fetchAndStoreExotelMedia] message record:", JSON.stringify(json).slice(0, 500));
            // Extract the media link from wherever Exotel puts it in the response.
            const mediaDownloadUrl = extractMediaUrlFromExotelMessage(json);
            if (mediaDownloadUrl) {
              try {
                const dlRes = await fetch(mediaDownloadUrl, { headers: { Authorization: auth } });
                if (dlRes.ok) {
                  buffer = Buffer.from(await dlRes.arrayBuffer());
                  break;
                }
                // Some Exotel CDN URLs are public — retry without auth.
                const dlResNoAuth = await fetch(mediaDownloadUrl);
                if (dlResNoAuth.ok) {
                  buffer = Buffer.from(await dlResNoAuth.arrayBuffer());
                  break;
                }
              } catch (e) {
                console.warn("[fetchAndStoreExotelMedia] media download error:", e);
              }
            }
            break; // Got a valid response from this host — don't retry with other region.
          }
          console.warn("[fetchAndStoreExotelMedia] GET message →", msgUrl, "→", res.status);
        } catch (e) {
          console.warn("[fetchAndStoreExotelMedia] fetch error:", msgUrl, e);
        }
      }

      // b) Try direct sub-resource endpoints as a fallback.
      if (!buffer) {
        const candidates: string[] = [];
        if (mediaId) {
          for (const h of hosts) candidates.push(`https://${h}/v2/accounts/${creds.sid}/media/${mediaId}`);
        }
        for (const h of hosts) {
          candidates.push(`https://${h}/v2/accounts/${creds.sid}/messages/${messageSid}/media`);
          candidates.push(`https://${h}/v2/accounts/${creds.sid}/messages/${messageSid}/media/0`);
        }
        for (const url of candidates) {
          try {
            const res = await fetch(url, { headers: { Authorization: auth } });
            if (res.ok) {
              buffer = Buffer.from(await res.arrayBuffer());
              break;
            }
            console.warn("[fetchAndStoreExotelMedia] sub-resource →", url, "→", res.status);
          } catch (e) {
            console.warn("[fetchAndStoreExotelMedia] fetch error:", url, e);
          }
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
