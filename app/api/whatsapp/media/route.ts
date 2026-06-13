import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import {
  getExotelCredentials,
  getExotelBasicAuthHeader,
} from "@/lib/exotel-config";
import { downloadExotelWhatsAppMedia } from "@/lib/whatsapp-media-storage";

export const runtime = "nodejs";

/**
 * Proxy for Exotel-hosted WhatsApp inbound media.
 *
 * Exotel stores inbound media either as:
 *   (a) A direct CDN link  →  supply ?url=<encoded-link>
 *   (b) A message SID      →  supply ?msgSid=<sid>
 *
 * The caller must supply a valid Supabase Bearer token (the mobile app does
 * this automatically via whatsAppMediaSource when the URL starts with BASE_URL).
 */
export async function GET(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const msgSid   = params.get("msgSid")?.trim()   || null;
  const mediaId  = params.get("mediaId")?.trim()  || null;
  const directUrl = params.get("url")?.trim()     || null;

  if (!msgSid && !mediaId && !directUrl) {
    return NextResponse.json({ error: "Provide msgSid, mediaId, or url query param" }, { status: 400 });
  }

  const downloaded = await downloadExotelWhatsAppMedia({
    mediaLink: directUrl,
    mediaId,
    messageSid: msgSid,
  });

  if (downloaded?.buffer.length) {
    return new NextResponse(new Uint8Array(downloaded.buffer), {
      status: 200,
      headers: {
        "Content-Type": downloaded.contentType,
        "Cache-Control": "private, max-age=86400",
      },
    });
  }

  // Legacy fallback: some Twilio/Exotel direct URLs need a plain fetch retry.
  if (directUrl) {
    try {
      const creds = getExotelCredentials();
      const headers = creds
        ? { Authorization: getExotelBasicAuthHeader(creds) }
        : undefined;
      const res = await fetch(directUrl, headers ? { headers } : undefined);
      if (res.ok) {
        const contentType = res.headers.get("content-type") ?? "application/octet-stream";
        return new NextResponse(await res.arrayBuffer(), {
          status: 200,
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "private, max-age=86400",
          },
        });
      }
      return NextResponse.json({ error: `Upstream returned ${res.status}` }, { status: res.status });
    } catch (e) {
      console.error("[whatsapp/media] direct fetch error:", e);
      return NextResponse.json({ error: "Failed to fetch media" }, { status: 502 });
    }
  }

  return NextResponse.json({ error: "Media not found for this message" }, { status: 404 });
}
