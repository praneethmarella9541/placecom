/** Client-side prep for outbound WhatsApp images (JPEG, resized) before upload. */

const MAX_IMAGE_DIM = 2048;
const JPEG_QUALITY = 0.85;

function isHeic(file: File): boolean {
  return /heic|heif/i.test(file.type) || /\.heic$/i.test(file.name) || /\.heif$/i.test(file.name);
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read this image in the browser."));
    img.src = url;
  });
}

/** Re-encode images to JPEG when needed so WhatsApp / Exotel accept them. */
export async function prepareOutboundFileForUpload(file: File): Promise<File> {
  const isImage =
    file.type.startsWith("image/") || /\.(jpe?g|png|gif|webp|heic|heif)$/i.test(file.name);

  if (!isImage) return file;

  if (isHeic(file)) {
    // Browsers usually cannot decode HEIC — try anyway; server will reject with a clear message.
    try {
      const url = URL.createObjectURL(file);
      try {
        await loadImage(url);
      } catch {
        throw new Error(
          "HEIC photos are not supported in the browser. Save as JPEG/PNG or use the mobile app."
        );
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("HEIC")) throw e;
      throw new Error(
        "HEIC photos are not supported in the browser. Save as JPEG/PNG or use the mobile app."
      );
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const largest = Math.max(img.width, img.height);
    const scale = largest > MAX_IMAGE_DIM ? MAX_IMAGE_DIM / largest : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const alreadyJpeg = file.type === "image/jpeg" && scale === 1 && file.size <= 4.5 * 1024 * 1024;
    if (alreadyJpeg) return file;

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not process image.");
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Failed to encode image as JPEG."))),
        "image/jpeg",
        JPEG_QUALITY
      );
    });

    const base = file.name.replace(/\.[^.]+$/, "") || "photo";
    return new File([blob], `${base}.jpg`, { type: "image/jpeg" });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadWhatsAppMediaFile(
  file: File
): Promise<{ url: string; kind: string; filename: string }> {
  const prepared = await prepareOutboundFileForUpload(file);
  const fd = new FormData();
  fd.append("file", prepared, prepared.name);
  const res = await fetch("/api/whatsapp/upload", {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  const data = (await res.json()) as {
    error?: string;
    url?: string;
    kind?: string;
    filename?: string;
  };
  if (!res.ok) throw new Error(data.error || "Upload failed");
  if (!data.url) throw new Error("Upload succeeded but no URL was returned.");
  return {
    url: data.url,
    kind: data.kind || "document",
    filename: data.filename || prepared.name,
  };
}
