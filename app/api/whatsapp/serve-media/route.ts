import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { WHATSAPP_MEDIA_BUCKET } from "@/lib/whatsapp-media-storage";
import { extensionForMime } from "@/lib/whatsapp-media-mime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  mp4: "video/mp4",
  "3gp": "video/3gpp",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  aac: "audio/aac",
  amr: "audio/amr",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/plain",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function contentTypeForPath(objectPath: string, storedType: string | null): string {
  if (storedType && storedType !== "application/octet-stream") return storedType;
  const ext = objectPath.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Public media URL for WhatsApp/Exotel outbound delivery.
 * Meta's servers must fetch media without auth — Supabase URLs sometimes
 * serve wrong Content-Type; this endpoint guarantees correct headers.
 *
 * GET /api/whatsapp/serve-media?p=<storage-object-path>
 */
export async function GET(request: Request) {
  const objectPath = new URL(request.url).searchParams.get("p")?.trim() ?? "";
  if (!objectPath || objectPath.includes("..") || objectPath.startsWith("/")) {
    return NextResponse.json({ error: "Invalid path" }, { status: 400 });
  }

  try {
    const supabase = createServiceSupabase();
    const { data, error } = await supabase.storage.from(WHATSAPP_MEDIA_BUCKET).download(objectPath);
    if (error || !data) {
      console.error("[whatsapp/serve-media] download failed:", objectPath, error?.message);
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const buffer = Buffer.from(await data.arrayBuffer());
    const contentType = contentTypeForPath(objectPath, data.type ?? null);
    const ext = extensionForMime(contentType);
    const filename = objectPath.split("/").pop() ?? `media.${ext}`;

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "public, max-age=604800, immutable",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    console.error("[whatsapp/serve-media] error:", e);
    return NextResponse.json({ error: "Failed to serve media" }, { status: 500 });
  }
}
