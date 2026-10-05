/**
 * Photos inserted into a mail body — Gmail's "Insert photo", not an attachment.
 *
 * While a mail is being written the photo lives in a public bucket and the body
 * points at it with an ordinary URL, so drafts, templates, sequence steps and
 * the review screen all just carry HTML. At send time sendMailViaGmail swaps
 * each of these URLs for an inline MIME part (`cid:`), so the recipient gets
 * the photo embedded in the mail, the way Gmail sends it — Outlook and other
 * clients that hold back remote images still show it straight away.
 *
 * Safe to import from client components.
 */

export const INLINE_IMAGE_BUCKET = "mail-inline-images";

/** A single photo larger than this is refused — it has to fit inside one email. */
export const INLINE_IMAGE_MAX_BYTES = 10 * 1024 * 1024;

/** Public URL prefix every inserted photo starts with. */
export function inlineImageUrlPrefix(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  return `${base}/storage/v1/object/public/${INLINE_IMAGE_BUCKET}/`;
}

export function isInlineImageUrl(url: string): boolean {
  const prefix = inlineImageUrlPrefix();
  return prefix.length > 40 && url.startsWith(prefix);
}

/** Why a picked file can't be inserted as a photo, or null when it can. */
export function inlineImageError(file: { name: string; type: string; size: number }): string | null {
  if (!file.type.startsWith("image/")) return `"${file.name}" isn't an image.`;
  if (file.size > INLINE_IMAGE_MAX_BYTES) {
    return `"${file.name}" is ${(file.size / (1024 * 1024)).toFixed(1)} MB — photos in the body can be at most ${INLINE_IMAGE_MAX_BYTES / (1024 * 1024)} MB. Attach it as a file instead.`;
  }
  return null;
}
