import { inlineImageError } from "@/lib/inline-images";
import { uploadToSignedUrl } from "@/lib/upload-to-signed-url";

/** Upload a photo for a mail body, with progress; resolves to its public URL. */
export async function uploadInlineImage(
  file: File,
  onProgress?: (percent: number) => void
): Promise<string> {
  const invalid = inlineImageError(file);
  if (invalid) throw new Error(invalid);

  const res = await fetch("/api/mail-images", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mimeType: file.type, size: file.size }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    signedUrl?: string;
    publicUrl?: string;
    error?: string;
  };
  if (!res.ok || !data.signedUrl || !data.publicUrl) {
    throw new Error(data.error || `Could not insert "${file.name}"`);
  }
  await uploadToSignedUrl(data.signedUrl, file, onProgress);
  return data.publicUrl;
}
