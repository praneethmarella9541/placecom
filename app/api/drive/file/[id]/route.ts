import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  buildDriveContentFetch,
  suggestedDownloadName,
} from "@/lib/drive-file-proxy";
import {
  getDriveFileDetails,
  getDriveFileParent,
  moveDriveFile,
  renameDriveFile,
  setDriveFileStarred,
} from "@/lib/drive";

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
  if (searchParams.get("details") === "1") {
    try {
      const details = await getDriveFileDetails(auth.accessToken, fileId);
      return NextResponse.json({ file: details });
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === "UNAUTHORIZED") {
        return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
      }
      return NextResponse.json({ error: err.message || "Failed to load details" }, { status: 500 });
    }
  }

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

/**
 * PATCH — rename a file/folder, move it to a new parent, or both.
 *
 * Body shape (all fields optional, at least one required):
 *   { name?: string, parentId?: string }
 *
 * For moves we resolve the file's current parent server-side so the caller
 * doesn't have to send it; this also handles legacy multi-parent files
 * (rare) by only swapping the first parent.
 */
export async function PATCH(
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

  let body: { name?: string; parentId?: string; starred?: boolean };
  try {
    body = (await request.json()) as { name?: string; parentId?: string; starred?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const nextName = typeof body.name === "string" ? body.name.trim() : undefined;
  const nextParent =
    typeof body.parentId === "string" ? body.parentId.trim() : undefined;
  const nextStarred = typeof body.starred === "boolean" ? body.starred : undefined;

  if (!nextName && !nextParent && nextStarred === undefined) {
    return NextResponse.json(
      { error: "Provide at least one of `name`, `parentId`, or `starred`" },
      { status: 400 }
    );
  }
  if (nextName && nextName.length > 256) {
    return NextResponse.json(
      { error: "Name is too long (max 256 chars)" },
      { status: 400 }
    );
  }

  try {
    let file;
    if (nextStarred !== undefined) {
      file = await setDriveFileStarred(auth.accessToken, fileId, nextStarred);
    }
    // Rename first if requested — keeps both ops idempotent if move fails.
    if (nextName) {
      file = await renameDriveFile(auth.accessToken, fileId, nextName);
    }
    if (nextParent) {
      const currentParent = await getDriveFileParent(auth.accessToken, fileId);
      if (!currentParent) {
        return NextResponse.json(
          { error: "Cannot determine current parent for move" },
          { status: 500 }
        );
      }
      if (currentParent !== nextParent) {
        file = await moveDriveFile(auth.accessToken, fileId, nextParent, currentParent);
      }
    }
    return NextResponse.json({ file });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
      return NextResponse.json(
        {
          error: "DRIVE_INSUFFICIENT_SCOPE",
          message:
            "Modifying files requires the full Drive scope. Sign out and sign in again to grant it.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || "Drive update failed" },
      { status: 500 }
    );
  }
}
