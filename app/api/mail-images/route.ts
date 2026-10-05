import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { createSignedUpload, safeStorageName } from "@/lib/storage-signed-upload";
import { INLINE_IMAGE_BUCKET, inlineImageError } from "@/lib/inline-images";

export const runtime = "nodejs";

let bucketReady: Promise<void> | null = null;

/**
 * Public, unlike the attachment buckets: an inserted photo is shown by URL in
 * the editor, in saved drafts and on the review screen. Paths are random, so a
 * photo is only reachable by whoever has the mail it sits in.
 */
function ensurePublicBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = createServiceSupabase()
      .storage.createBucket(INLINE_IMAGE_BUCKET, { public: true })
      .then(
        () => undefined,
        () => undefined,
      );
  }
  return bucketReady;
}

/**
 * POST /api/mail-images  { filename, mimeType, size } → { signedUrl, publicUrl }
 *
 * Signs a direct upload for a photo being inserted into a mail body; the
 * browser uploads straight to storage (with progress) and then puts publicUrl
 * in the body. See lib/inline-images.
 */
export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    filename?: unknown;
    mimeType?: unknown;
    size?: unknown;
  };
  const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType.trim() : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!filename || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "No image received" }, { status: 400 });
  }
  const invalid = inlineImageError({ name: filename, type: mimeType, size });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  try {
    await ensurePublicBucket();
    const path = `${user.id}/${randomUUID()}-${safeStorageName(filename)}`;
    const signed = await createSignedUpload(INLINE_IMAGE_BUCKET, path);
    const { data } = createServiceSupabase().storage.from(INLINE_IMAGE_BUCKET).getPublicUrl(path);
    return NextResponse.json({ signedUrl: signed.signedUrl, publicUrl: data.publicUrl });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not prepare the upload" },
      { status: 500 },
    );
  }
}
