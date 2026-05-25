import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  gmailInsufficientScopePayload,
  isGmailInsufficientScopeResponse,
} from "@/lib/gmail-scope-error";

export const runtime = "nodejs";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const messageId = searchParams.get("messageId");
  const attachmentId = searchParams.get("attachmentId");
  const filename = searchParams.get("filename") || "attachment";
  const mimeType = searchParams.get("mimeType") || "application/octet-stream";

  if (!messageId || !attachmentId) {
    return NextResponse.json({ error: "messageId and attachmentId required" }, { status: 400 });
  }

  const url = `${GMAIL_API}/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    if (isGmailInsufficientScopeResponse(res.status, text)) {
      return NextResponse.json(gmailInsufficientScopePayload(), { status: 403 });
    }
    return NextResponse.json(
      { error: `Gmail attachment error ${res.status}: ${text}` },
      { status: res.status }
    );
  }

  const data = (await res.json()) as { data?: string; size?: number };
  if (!data.data) {
    return NextResponse.json({ error: "No attachment data" }, { status: 404 });
  }

  const base64 = data.data.replace(/-/g, "+").replace(/_/g, "/");
  const buffer = Buffer.from(base64, "base64");

  // Serve inline so the browser can render images, PDFs, video, audio, text.
  // The client passes ?download=1 when it explicitly wants a forced download.
  const forceDownload = searchParams.get("download") === "1";
  const disposition = forceDownload
    ? `attachment; filename="${encodeURIComponent(filename)}"`
    : `inline; filename="${encodeURIComponent(filename)}"`;

  return new Response(buffer, {
    status: 200,
    headers: {
      "Content-Type": mimeType,
      "Content-Disposition": disposition,
      "Content-Length": String(buffer.byteLength),
      // Allow preview in <iframe> / <img> from same origin
      "X-Frame-Options": "SAMEORIGIN",
      "Cache-Control": "private, max-age=300",
    },
  });
}
