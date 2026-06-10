import "server-only";

/** WhatsApp Cloud API supported MIME types per media kind. */
export const WHATSAPP_SUPPORTED_MIMES: Record<string, readonly string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  video: ["video/mp4", "video/3gpp"],
  audio: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"],
  document: [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "text/plain",
  ],
};

const MIME_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "audio/m4a": "audio/mp4",
  "audio/x-m4a": "audio/mp4",
  "audio/x-aac": "audio/aac",
  "audio/mp3": "audio/mpeg",
  "video/3gp": "video/3gpp",
};

const EXT_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  "3gpp": "video/3gpp",
  aac: "audio/aac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  amr: "audio/amr",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  txt: "text/plain",
};

export function inferWhatsAppMediaKind(mimeType: string): "image" | "video" | "audio" | "document" {
  const m = mimeType.toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  return "document";
}

export function extensionForMime(mimeType: string): string {
  const m = mimeType.toLowerCase();
  if (m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/gif") return "gif";
  if (m === "video/mp4") return "mp4";
  if (m === "video/3gpp") return "3gp";
  if (m === "audio/mp4") return "m4a";
  if (m === "audio/mpeg") return "mp3";
  if (m === "audio/aac") return "aac";
  if (m === "audio/amr") return "amr";
  if (m === "audio/ogg") return "ogg";
  if (m === "application/pdf") return "pdf";
  if (m === "text/plain") return "txt";
  return "bin";
}

/** Sniff actual file type from magic bytes (not from client-declared MIME). */
export function sniffMimeType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return "image/png";
  }
  if (buffer.length >= 6) {
    const head = buffer.slice(0, 6).toString("ascii");
    if (head === "GIF87a" || head === "GIF89a") return "image/gif";
  }
  if (buffer.length >= 12 && buffer.slice(0, 4).toString("ascii") === "RIFF" && buffer.slice(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 12 && buffer.slice(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.slice(8, 12).toString("ascii").toLowerCase();
    if (brand.includes("heic") || brand.includes("heif") || brand.includes("mif1")) {
      return "image/heic";
    }
    if (brand.includes("qt")) return "video/quicktime";
    return "video/mp4";
  }
  if (buffer.length >= 4 && buffer.slice(0, 4).toString("ascii") === "%PDF") {
    return "application/pdf";
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xf0) === 0xf0) {
    return "audio/aac";
  }
  if (buffer.length >= 3 && buffer.slice(0, 3).toString("ascii") === "ID3") {
    return "audio/mpeg";
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfb) {
    return "audio/mpeg";
  }
  return null;
}

function mimeFromFilename(filename: string): string | null {
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!ext) return null;
  return EXT_TO_MIME[ext] ?? null;
}

export function normalizeDeclaredMime(mimeType: string, filename: string): string {
  const raw = mimeType?.trim().toLowerCase().split(";")[0].trim() || "";
  if (raw && raw !== "application/octet-stream") {
    return MIME_ALIASES[raw] ?? raw;
  }
  return mimeFromFilename(filename) ?? raw ?? "application/octet-stream";
}

export type ResolvedWhatsAppMedia = {
  mimeType: string;
  kind: "image" | "video" | "audio" | "document";
};

/**
 * Resolve the MIME type WhatsApp will see: prefer sniffed bytes over client metadata.
 * Throws if the file format is unsupported or mismatched (e.g. HEIC labeled as JPEG).
 */
export function resolveWhatsAppMediaMime(params: {
  declaredMime: string;
  filename: string;
  file: Buffer;
}): ResolvedWhatsAppMedia {
  const declared = normalizeDeclaredMime(params.declaredMime, params.filename);
  const sniffed = sniffMimeType(params.file);

  let mimeType = sniffed ?? declared;
  mimeType = MIME_ALIASES[mimeType] ?? mimeType;

  if (mimeType === "image/heic" || mimeType === "image/heif") {
    throw new Error(
      "HEIC photos are not supported by WhatsApp. Pick the photo again — the app will convert it to JPEG automatically."
    );
  }
  if (mimeType === "video/quicktime") {
    throw new Error(
      "MOV/QuickTime video is not supported by WhatsApp. Use MP4 video or record from the camera in the app."
    );
  }

  // Client said JPEG but bytes are something else — trust the bytes.
  if (sniffed && declared && sniffed !== declared && declared !== "application/octet-stream") {
    const declaredKind = inferWhatsAppMediaKind(declared);
    const sniffedKind = inferWhatsAppMediaKind(sniffed);
    if (declaredKind !== sniffedKind) {
      throw new Error(
        `File looks like ${sniffedKind} (${sniffed}) but was sent as ${declaredKind} (${declared}). Try picking the file again.`
      );
    }
    mimeType = sniffed;
  }

  const kind = inferWhatsAppMediaKind(mimeType);
  const supported = WHATSAPP_SUPPORTED_MIMES[kind];
  if (!supported?.includes(mimeType)) {
    const examples = supported?.slice(0, 3).join(", ") ?? "";
    throw new Error(
      `"${mimeType}" is not supported by WhatsApp for ${kind} messages.${examples ? ` Supported: ${examples}…` : ""}`
    );
  }

  return { mimeType, kind };
}

export function buildStorageFilename(originalName: string, mimeType: string): string {
  const safe = originalName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60) || "upload";
  const ext = extensionForMime(mimeType);
  const base = safe.replace(/\.[^.]+$/, "") || "upload";
  return `${base}.${ext}`;
}
