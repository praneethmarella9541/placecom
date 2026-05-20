import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthedRequest } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: { recordingSid: string } }
) {
  const authed = await getAuthedRequest(request);
  if (!authed) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const recordingSid = context.params.recordingSid?.trim() || "";
  if (!recordingSid) {
    return NextResponse.json({ error: "Missing recording ID" }, { status: 400 });
  }

  const apiKey   = process.env.EXOTEL_API_KEY?.trim();
  const apiToken = process.env.EXOTEL_API_TOKEN?.trim();

  if (!apiKey || !apiToken) {
    return NextResponse.json({ error: "Exotel credentials not configured" }, { status: 500 });
  }

  // recording_sid stores the full S3 URL — look up by matching it in the DB
  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: row } = await svc
    .from("call_logs")
    .select("id, recording_sid")
    .eq("user_id", authed.user.id)
    .eq("recording_sid", recordingSid)
    .maybeSingle();

  if (!row?.recording_sid) {
    return NextResponse.json({ error: "Recording not found" }, { status: 404 });
  }

  const basic = Buffer.from(`${apiKey}:${apiToken}`).toString("base64");

  // Stored value may be a full URL (S3 or api.exotel.com) or a bare API path
  let fetchUrl = row.recording_sid;
  if (!fetchUrl.startsWith("http")) {
    fetchUrl = `https://api.exotel.com${fetchUrl.startsWith("/") ? "" : "/"}${fetchUrl}`;
  }

  // Forward Range header so audio players can seek
  const rangeHeader = request.headers.get("range");
  const upstreamHeaders: Record<string, string> = { Authorization: `Basic ${basic}` };
  if (rangeHeader) upstreamHeaders["Range"] = rangeHeader;

  const upstream = await fetch(fetchUrl, { headers: upstreamHeaders });

  if (!upstream.ok || !upstream.body) {
    return NextResponse.json({ error: `Recording unavailable (${upstream.status})` }, { status: 502 });
  }

  const respHeaders: Record<string, string> = {
    "Content-Type": "audio/mpeg",
    "Cache-Control": "private, max-age=3600",
    "Accept-Ranges": "bytes",
  };
  const contentLength = upstream.headers.get("content-length");
  if (contentLength) respHeaders["Content-Length"] = contentLength;
  const contentRange = upstream.headers.get("content-range");
  if (contentRange) respHeaders["Content-Range"] = contentRange;

  return new NextResponse(upstream.body, {
    status: upstream.status,
    headers: respHeaders,
  });
}
