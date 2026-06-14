/** Resolve the original filename from a WhatsApp media upload request. */

const CACHE_LIKE_RE =
  /^(upload|file|document|audio|photo|video|image)(-\d+)?(\.[a-z0-9]+)?$/i;
const HEX_CACHE_RE = /^[0-9a-f]{8,}(\.[a-z0-9]+)?$/i;
const NUMERIC_CACHE_RE = /^\d+(\.[a-z0-9]+)?$/i;

export function isCacheLikeUploadFilename(name: string): boolean {
  const n = name.trim();
  if (!n) return true;
  if (CACHE_LIKE_RE.test(n)) return true;
  if (HEX_CACHE_RE.test(n)) return true;
  if (NUMERIC_CACHE_RE.test(n)) return true;
  if (/^documentpicker/i.test(n)) return true;
  if (/^imagepicker/i.test(n)) return true;
  if (/^rn_image_picker/i.test(n)) return true;
  return false;
}

export function resolveWhatsAppUploadFilename(params: {
  form: FormData | null | undefined;
  file: Blob;
  request: Request;
}): string {
  const fromField = params.form?.get("filename");
  const fieldName = typeof fromField === "string" ? fromField.trim() : "";

  const headerRaw = params.request.headers.get("x-original-filename")?.trim() ?? "";
  let headerName = "";
  if (headerRaw) {
    try {
      headerName = decodeURIComponent(headerRaw).trim();
    } catch {
      headerName = headerRaw;
    }
  }

  const partName =
    params.file instanceof File && params.file.name.trim()
      ? params.file.name.trim()
      : "";

  for (const candidate of [fieldName, headerName, partName]) {
    if (candidate && !isCacheLikeUploadFilename(candidate)) {
      return candidate.slice(0, 240);
    }
  }

  return "upload";
}
