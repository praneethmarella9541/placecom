import "server-only";

import { getWebhookBaseUrl } from "@/lib/call-recording-url";
import { createServiceSupabase } from "@/lib/supabase-service";
import {
  getExotelCredentials,
  getExotelBasicAuthHeader,
  getExotelApiHostCandidates,
} from "@/lib/exotel-config";
import { buildStorageFilename, resolveWhatsAppMediaMime } from "@/lib/whatsapp-media-mime";
import { whatsAppMediaProxyPath } from "@/lib/whatsapp-media-resolve";
import { randomUUID } from "crypto";

export { inferWhatsAppMediaKind } from "@/lib/whatsapp-media-mime";

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
      // Create if not yet present; ignore "already exists" error.
      await supabase.storage.createBucket(WHATSAPP_MEDIA_BUCKET, { public: true }).catch(() => {});
      // Always ensure bucket is public (handles pre-existing private buckets).
      await supabase.storage.updateBucket(WHATSAPP_MEDIA_BUCKET, { public: true }).catch(() => {});
    })();
  }
  return bucketReady;
}

export function maxBytesForKind(kind: string): number {
  return MAX_BYTES[kind] ?? MAX_BYTES.document;
}

/** Public HTTPS URL that Exotel/Meta can fetch without auth. */
export function getWhatsAppMediaServeUrl(objectPath: string): string {
  const base = getWebhookBaseUrl();
  if (!base) {
    throw new Error("NEXT_PUBLIC_APP_URL is not configured for WhatsApp media delivery.");
  }
  return `${base}/api/whatsapp/serve-media?p=${encodeURIComponent(objectPath)}`;
}

export async function uploadWhatsAppMedia(params: {
  userId: string;
  file: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{ publicUrl: string; kind: "image" | "video" | "audio" | "document"; storagePath: string }> {
  await ensureBucket();

  const { mimeType, kind } = resolveWhatsAppMediaMime({
    declaredMime: params.mimeType,
    filename: params.filename,
    file: params.file,
  });

  if (params.file.length > maxBytesForKind(kind)) {
    throw new Error(`File too large for WhatsApp ${kind} (max ${Math.round(maxBytesForKind(kind) / 1024 / 1024)} MB).`);
  }

  const storageName = buildStorageFilename(params.filename, mimeType);
  const objectPath = `${params.userId}/${randomUUID()}-${storageName}`;
  const supabase = createServiceSupabase();
  const { error } = await supabase.storage.from(WHATSAPP_MEDIA_BUCKET).upload(objectPath, params.file, {
    contentType: mimeType,
    upsert: false,
    cacheControl: "604800",
  });
  if (error) throw new Error(error.message);

  const publicUrl = getWhatsAppMediaServeUrl(objectPath);
  return { publicUrl, kind, storagePath: objectPath };
}

/**
 * Walk the nested Exotel message JSON response to find a downloadable media URL.
 * Exotel's message GET response wraps content differently across API versions.
 */
export function extractMediaUrlFromExotelMessage(json: Record<string, unknown>): string | null {
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

export type DownloadedExotelMedia = {
  buffer: Buffer;
  contentType: string;
};

/** Download inbound WhatsApp media bytes from Exotel (CDN link, message record, or media API). */
export async function downloadExotelWhatsAppMedia(params: {
  mediaLink: string | null;
  mediaId: string | null;
  messageSid: string | null;
  contentType?: string | null;
}): Promise<DownloadedExotelMedia | null> {
  const { mediaLink, mediaId, messageSid } = params;
  const fallbackType = params.contentType?.trim() || "application/octet-stream";

  async function fetchBuffer(
    url: string,
    headers?: Record<string, string>
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    try {
      const res = await fetch(url, headers ? { headers } : undefined);
      if (!res.ok) return null;
      const contentType = res.headers.get("content-type")?.trim() || fallbackType;
      return { buffer: Buffer.from(await res.arrayBuffer()), contentType };
    } catch (e) {
      console.warn("[downloadExotelWhatsAppMedia] fetch failed:", url, e);
      return null;
    }
  }

  if (mediaLink) {
    const direct = await fetchBuffer(mediaLink);
    if (direct?.buffer.length) return direct;
    const creds = getExotelCredentials();
    if (creds) {
      const authed = await fetchBuffer(mediaLink, {
        Authorization: getExotelBasicAuthHeader(creds),
      });
      if (authed?.buffer.length) return authed;
    }
  }

  if (!messageSid) return null;

  const creds = getExotelCredentials();
  if (!creds) return null;
  const auth = getExotelBasicAuthHeader(creds);
  const hosts = getExotelApiHostCandidates();

  for (const h of hosts) {
    const msgUrl = `https://${h}/v2/accounts/${creds.sid}/messages/${messageSid}`;
    try {
      const res = await fetch(msgUrl, { headers: { Authorization: auth } });
      if (!res.ok) {
        console.warn("[downloadExotelWhatsAppMedia] GET message →", msgUrl, "→", res.status);
        continue;
      }
      const json = (await res.json()) as Record<string, unknown>;
      const mediaDownloadUrl = extractMediaUrlFromExotelMessage(json);
      if (mediaDownloadUrl) {
        const authed = await fetchBuffer(mediaDownloadUrl, { Authorization: auth });
        if (authed?.buffer.length) return authed;
        const plain = await fetchBuffer(mediaDownloadUrl);
        if (plain?.buffer.length) return plain;
      }
      break;
    } catch (e) {
      console.warn("[downloadExotelWhatsAppMedia] message record error:", msgUrl, e);
    }
  }

  const candidates: string[] = [];
  if (mediaId) {
    for (const h of hosts) {
      candidates.push(`https://${h}/v2/accounts/${creds.sid}/media/${mediaId}`);
    }
  }
  for (const h of hosts) {
    candidates.push(`https://${h}/v2/accounts/${creds.sid}/messages/${messageSid}/media`);
    candidates.push(`https://${h}/v2/accounts/${creds.sid}/messages/${messageSid}/media/0`);
  }
  for (const url of candidates) {
    const hit = await fetchBuffer(url, { Authorization: auth });
    if (hit?.buffer.length) return hit;
    console.warn("[downloadExotelWhatsAppMedia] sub-resource miss:", url);
  }

  return null;
}

/**
 * Download inbound WhatsApp media from Exotel, store in Supabase when possible,
 * and always return a URL the app can load (serve-media or authenticated proxy).
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
  const downloaded = await downloadExotelWhatsAppMedia({
    mediaLink,
    mediaId,
    messageSid,
    contentType: params.contentType,
  });

  if (downloaded?.buffer.length) {
    try {
      const ext = downloaded.contentType.split("/")[1]?.replace(/\+.*/, "") || "bin";
      const { publicUrl } = await uploadWhatsAppMedia({
        userId: businessE164.replace(/\D/g, ""),
        file: downloaded.buffer,
        filename: `inbound.${ext}`,
        mimeType: downloaded.contentType,
      });
      return publicUrl;
    } catch (e) {
      console.warn("[fetchAndStoreExotelMedia] Supabase upload failed:", e);
    }
  }

  const proxy = whatsAppMediaProxyPath({ messageSid, mediaLink });
  if (proxy) {
    console.warn("[fetchAndStoreExotelMedia] using proxy URL:", proxy);
    return proxy;
  }

  console.warn("[fetchAndStoreExotelMedia] could not resolve any media URL");
  return null;
}
