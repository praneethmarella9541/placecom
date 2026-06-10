import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import {
  getExotelCredentials,
  getExotelBasicAuthHeader,
  getExotelApiHostCandidates,
} from "@/lib/exotel-config";

export const runtime = "nodejs";

/**
 * Proxy for Exotel-hosted WhatsApp inbound media.
 *
 * Exotel stores inbound media either as:
 *   (a) A direct CDN link  →  supply ?url=<encoded-link>
 *   (b) A message SID      →  supply ?msgSid=<sid>
 *       → fetches  GET https://{host}/v2/accounts/{exotelSid}/messages/{msgSid}/media/0
 *
 * The caller must supply a valid Supabase Bearer token (the mobile app does
 * this automatically via whatsAppMediaSource when the URL starts with BASE_URL).
 *
 * Usage:
 *   GET /api/whatsapp/media?msgSid=EX_MSG_SID
 *   GET /api/whatsapp/media?url=<url-encoded-direct-cdn-link>
 */
export async function GET(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const msgSid = params.get("msgSid")?.trim();
  const directUrl = params.get("url")?.trim();

  if (!msgSid && !directUrl) {
    return NextResponse.json({ error: "Provide msgSid or url query param" }, { status: 400 });
  }

  // ── Case A: direct CDN link ───────────────────────────────────────────────
  if (directUrl) {
    try {
      const res = await fetch(directUrl);
      if (!res.ok) {
        return NextResponse.json({ error: `Upstream returned ${res.status}` }, { status: res.status });
      }
      const contentType = res.headers.get("content-type") ?? "application/octet-stream";
      return new NextResponse(await res.arrayBuffer(), {
        status: 200,
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=86400",
        },
      });
    } catch (e) {
      console.error("[whatsapp/media] direct fetch error:", e);
      return NextResponse.json({ error: "Failed to fetch media" }, { status: 502 });
    }
  }

  // ── Case B: Exotel message SID → fetch via Exotel media API ─────────────
  const creds = getExotelCredentials();
  if (!creds) {
    return NextResponse.json({ error: "Exotel not configured" }, { status: 500 });
  }

  const authHeader = getExotelBasicAuthHeader(creds);
  const hosts = getExotelApiHostCandidates();

  let lastStatus = 0;
  for (const host of hosts) {
    const mediaUrl = `https://${host}/v2/accounts/${creds.sid}/messages/${msgSid}/media/0`;
    let res: Response;
    try {
      res = await fetch(mediaUrl, { headers: { Authorization: authHeader } });
    } catch (e) {
      console.error("[whatsapp/media] Exotel fetch error:", e);
      continue;
    }

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

    lastStatus = res.status;
    // 401 with multiple hosts → try next region
    if (res.status !== 401 || hosts.length === 1) break;
  }

  return NextResponse.json(
    { error: `Exotel media returned ${lastStatus || "no response"}` },
    { status: lastStatus || 502 }
  );
}
