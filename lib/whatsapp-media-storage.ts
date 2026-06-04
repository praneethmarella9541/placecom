import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";
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
