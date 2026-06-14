import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { getWebhookBaseUrlFromRequest } from "@/lib/call-recording-url";
import { uploadWhatsAppMedia } from "@/lib/whatsapp-media-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");

  // React Native's fetch sends FormData files as Blob (not File). Both extend
  // Blob so we accept any Blob-like object that has arrayBuffer().
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }

  // Web sends File (has .name). React Native sends a Blob-like part — use explicit filename field.
  const filenameField = form?.get("filename");
  const filenameFromField =
    typeof filenameField === "string" ? filenameField.trim() : "";
  const filename =
    (file instanceof File ? file.name.trim() : "") ||
    filenameFromField ||
    "upload";
  const mimeType = file.type || "application/octet-stream";

  try {
    const publicBaseUrl = getWebhookBaseUrlFromRequest(request);
    const { publicUrl, kind } = await uploadWhatsAppMedia({
      userId: user.id,
      file: buffer,
      filename,
      mimeType,
      publicBaseUrl,
    });
    return NextResponse.json({
      ok: true,
      url: publicUrl,
      kind,
      messageType: kind,
      filename,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
