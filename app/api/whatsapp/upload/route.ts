import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { uploadWhatsAppMedia } from "@/lib/whatsapp-media-storage";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || !(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) {
    return NextResponse.json({ error: "Empty file" }, { status: 400 });
  }

  try {
    const { publicUrl, kind } = await uploadWhatsAppMedia({
      userId: user.id,
      file: buffer,
      filename: file.name || "upload",
      mimeType: file.type || "application/octet-stream",
    });
    return NextResponse.json({
      ok: true,
      url: publicUrl,
      kind,
      messageType: kind,
      filename: file.name,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Upload failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
