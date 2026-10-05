import { uploadFormDataWithProgress } from "@/lib/upload-form-progress";

/**
 * Upload one file to a Supabase Storage signed upload URL, reporting progress.
 *
 * supabase-js's uploadToSignedUrl sends the same request but through fetch,
 * which can't report upload progress. This is that request over XHR: a PUT of
 * multipart form data with the file under an empty field name, plus the
 * project's public key, which the Storage gateway expects on every call. The
 * token in the URL is what authorizes the write.
 */
export async function uploadToSignedUrl(
  signedUrl: string,
  file: File,
  onProgress?: (percent: number) => void
): Promise<void> {
  const form = new FormData();
  form.append("cacheControl", "3600");
  form.append("", file);

  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  const { status, responseText } = await uploadFormDataWithProgress(signedUrl, form, {
    method: "PUT",
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, "x-upsert": "false" },
    onProgress: ({ loaded, total }) => {
      if (total > 0) onProgress?.(Math.min(99, Math.round((loaded / total) * 99)));
    },
  });
  if (status < 200 || status >= 300) {
    let message = `upload failed (${status})`;
    try {
      const parsed = JSON.parse(responseText) as { message?: string; error?: string };
      message = parsed.message || parsed.error || message;
    } catch {
      /* non-JSON */
    }
    throw new Error(message);
  }
  onProgress?.(100);
}
