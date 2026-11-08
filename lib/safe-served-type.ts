/**
 * What a route may tell the browser about a file it serves from this site's own origin.
 *
 * Mail attachments and Drive files are written by other people. If one of them came back as
 * text/html or image/svg+xml with an "inline" disposition, opening it would run its script on
 * our origin with the signed-in user's access (CASA 5.2.1: uploaded content must not execute).
 * The caller's or upstream's claimed type is therefore never passed through as-is:
 *
 *  - raster images, PDF, audio and video are passive: served as themselves, may render inline;
 *  - any text/* type (including text/html and text/xml) is served as text/plain, so a preview
 *    shows the source instead of running it;
 *  - everything else, SVG and XML included, becomes application/octet-stream and a download.
 *
 * The octet-stream rewrite matters beyond the Content-Disposition header: the web app fetches
 * these responses as blobs and shows them from blob: URLs, which ignore Content-Disposition and
 * take their type from Content-Type.
 */

const RASTER_IMAGES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
  "image/bmp",
]);

export type ServedType = {
  /** The Content-Type to send. */
  contentType: string;
  /** Whether the browser may render it in place (otherwise send it as an attachment). */
  inline: boolean;
};

export function normalizeMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0].trim().toLowerCase();
}

export function safeServedType(mime: string | null | undefined): ServedType {
  const m = normalizeMime(mime);
  if (RASTER_IMAGES.has(m) || m === "application/pdf") return { contentType: m, inline: true };
  if (/^(audio|video)\/[a-z0-9.+-]+$/.test(m)) return { contentType: m, inline: true };
  if (m.startsWith("text/")) return { contentType: "text/plain; charset=utf-8", inline: true };
  return { contentType: "application/octet-stream", inline: false };
}
