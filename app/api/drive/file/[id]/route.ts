import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  buildDriveContentFetch,
  suggestedDownloadName,
} from "@/lib/drive-file-proxy";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_BINARY_PREVIEW_BYTES = 20 * 1024 * 1024;

/** Allow this app to embed preview responses in an iframe (same origin). */
const FRAMING_HEADERS = {
  "X-Frame-Options": "SAMEORIGIN",
  "Content-Security-Policy": "frame-ancestors 'self'",
} as const;

function previewErrorHtml(message: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Preview</title>
  <style>body{font-family:system-ui,sans-serif;padding:24px;background:#fafafa;color:#444;}</style>
  </head><body><p>${message.replace(/</g, "&lt;")}</p></body></html>`;
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const fileId = params.id?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "Missing file id" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("mode") === "download" ? "download" : "preview";

  const metaRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size`,
    { headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );

  if (metaRes.status === 401) {
    return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
  }
  if (!metaRes.ok) {
    const t = await metaRes.text();
    if (mode === "preview") {
      return new NextResponse(previewErrorHtml(`Could not load file: ${metaRes.status}`), {
        status: metaRes.status,
        headers: { "Content-Type": "text/html; charset=utf-8", ...FRAMING_HEADERS },
      });
    }
    return NextResponse.json({ error: t || "Metadata failed" }, { status: metaRes.status });
  }

  const meta = (await metaRes.json()) as {
    name?: string;
    mimeType?: string;
    size?: string;
  };
  const mimeType = meta.mimeType || "application/octet-stream";
  const name = meta.name || "file";

  const built = buildDriveContentFetch(fileId, mimeType, mode);
  if ("error" in built) {
    return NextResponse.json({ error: built.error }, { status: 400 });
  }

  if (mode === "preview" && built.url.includes("alt=media")) {
    const sz = meta.size ? parseInt(meta.size, 10) : NaN;
    if (!Number.isNaN(sz) && sz > MAX_BINARY_PREVIEW_BYTES) {
      return new NextResponse(
        previewErrorHtml("This file is too large to preview. Use download instead."),
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...FRAMING_HEADERS } }
      );
    }
  }

  let upstream: Response;
  try {
    upstream = await fetch(built.url, {
      headers: { Authorization: `Bearer ${auth.accessToken}` },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Fetch failed";
    if (mode === "preview") {
      return new NextResponse(previewErrorHtml(msg), {
        status: 502,
        headers: { "Content-Type": "text/html; charset=utf-8", ...FRAMING_HEADERS },
      });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  if (upstream.status === 401) {
    return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
  }

  if (!upstream.ok) {
    const text = await upstream.text();
    if (text.includes("insufficientPermissions") || text.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT")) {
      return NextResponse.json(
        { error: "Drive permission denied for this file or scope." },
        { status: 403 }
      );
    }
    if (mode === "preview") {
      return new NextResponse(
        previewErrorHtml(`Preview failed (${upstream.status}). Try download, or this type may not export.`),
        { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", ...FRAMING_HEADERS } }
      );
    }
    return NextResponse.json({ error: text || `Upstream ${upstream.status}` }, { status: upstream.status });
  }

  const disposition =
    mode === "download" ? "attachment" : "inline";
  const filename = suggestedDownloadName(name, built.resultMime);
  const cd = `${disposition}; filename*=UTF-8''${encodeURIComponent(filename)}`;

  const contentType =
    upstream.headers.get("Content-Type")?.split(";")[0]?.trim() || built.resultMime;

  if (!upstream.body) {
    const buf = Buffer.from(await upstream.arrayBuffer());
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": cd,
        "Cache-Control": "private, no-store",
        ...FRAMING_HEADERS,
      },
    });
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": cd,
      "Cache-Control": "private, no-store",
      ...FRAMING_HEADERS,
    },
  });
}
