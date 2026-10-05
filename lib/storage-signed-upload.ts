import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";

/**
 * Browser → private bucket uploads, shared by mail template and sequence step
 * attachments.
 *
 * Bytes never pass through our API on the way in: a serverless request body
 * tops out (4.5 MB on Vercel) well below Gmail's 25 MB, so the API signs a
 * one-shot upload URL after checking the declared size, the browser uploads
 * straight to storage, and the API re-checks the stored size before recording
 * the file.
 */

const ready = new Map<string, Promise<void>>();

/** Create the private bucket once per process; a no-op when it already exists. */
export function ensurePrivateBucket(bucket: string): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Promise.resolve();
  }
  let p = ready.get(bucket);
  if (!p) {
    p = createServiceSupabase()
      .storage.createBucket(bucket, { public: false })
      .then(() => undefined, () => undefined);
    ready.set(bucket, p);
  }
  return p;
}

/** Keep the original name readable in storage without letting it shape the path. */
export function safeStorageName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "file";
}

/**
 * A one-shot signed URL the browser uploads one file to. `signedUrl` is the
 * full upload URL (token included), which the browser PUTs to directly so it
 * can report progress (lib/upload-to-signed-url).
 */
export async function createSignedUpload(
  bucket: string,
  path: string
): Promise<{ path: string; token: string; signedUrl: string }> {
  await ensurePrivateBucket(bucket);
  const { data, error } = await createServiceSupabase()
    .storage.from(bucket)
    .createSignedUploadUrl(path);
  if (error || !data) throw new Error(error?.message || "Could not prepare the upload");
  return { path: data.path, token: data.token, signedUrl: data.signedUrl };
}

/** Size of an uploaded object in bytes, or null when nothing is there. */
export async function storedObjectSize(bucket: string, path: string): Promise<number | null> {
  await ensurePrivateBucket(bucket);
  const slash = path.lastIndexOf("/");
  const folder = path.slice(0, slash);
  const name = path.slice(slash + 1);
  const { data, error } = await createServiceSupabase()
    .storage.from(bucket)
    .list(folder, { search: name, limit: 10 });
  if (error) return null;
  const hit = (data ?? []).find((f) => f.name === name);
  const size = (hit?.metadata as { size?: number } | undefined)?.size;
  return typeof size === "number" ? size : null;
}

/** A Drive link the client reports back: a plain file id and a Google-hosted URL. */
export function isValidDriveLink(fileId: string, webViewLink: string): boolean {
  return (
    /^[A-Za-z0-9_-]{10,}$/.test(fileId) &&
    /^https:\/\/(drive|docs)\.google\.com\//.test(webViewLink)
  );
}
