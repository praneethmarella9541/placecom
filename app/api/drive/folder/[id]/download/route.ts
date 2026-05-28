import { NextResponse } from "next/server";
import { PassThrough } from "node:stream";
import archiver from "archiver";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  getDriveFileMeta,
  listFolderChildren,
} from "@/lib/drive";
import { buildDriveContentFetch, suggestedDownloadName } from "@/lib/drive-file-proxy";

export const runtime = "nodejs";
export const maxDuration = 300;

const FOLDER_MIME = "application/vnd.google-apps.folder";
// Guardrails so a huge tree can't hang the request.
const MAX_FILES = 1000;
const MAX_DEPTH = 25;

type Entry = { id: string; name: string; mimeType: string; path: string };

/**
 * GET — download a folder (and everything inside it) as a single .zip.
 * Walks the tree breadth-first, streaming each file into the archive under
 * its relative path. Google Workspace files are exported (Docs→PDF, etc.)
 * via the shared content-proxy logic, matching single-file download.
 */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const folderId = params.id?.trim();
  if (!folderId) {
    return NextResponse.json({ error: "Missing folder id" }, { status: 400 });
  }

  let rootName = "folder";
  try {
    const meta = await getDriveFileMeta(auth.accessToken, folderId);
    if (meta.mimeType !== FOLDER_MIME) {
      return NextResponse.json({ error: "Not a folder" }, { status: 400 });
    }
    rootName = meta.name || "folder";
  } catch (e) {
    return errJson(e);
  }

  // Collect all downloadable files (BFS), tracking relative paths.
  const files: Entry[] = [];
  try {
    const queue: { id: string; path: string; depth: number }[] = [
      { id: folderId, path: "", depth: 0 },
    ];
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur.depth > MAX_DEPTH) continue;
      const children = await listFolderChildren(auth.accessToken, cur.id);
      for (const c of children) {
        const childPath = cur.path ? `${cur.path}/${sanitize(c.name)}` : sanitize(c.name);
        if (c.mimeType === FOLDER_MIME) {
          queue.push({ id: c.id, path: childPath, depth: cur.depth + 1 });
        } else {
          files.push({ id: c.id, name: c.name, mimeType: c.mimeType, path: childPath });
          if (files.length >= MAX_FILES) break;
        }
      }
      if (files.length >= MAX_FILES) break;
    }
  } catch (e) {
    return errJson(e);
  }

  // Build the zip as a Node stream and hand it to the Response.
  const archive = archiver("zip", { zlib: { level: 6 } });
  const pass = new PassThrough();
  archive.pipe(pass);

  archive.on("error", (err) => {
    // Best-effort: abort the stream; the client gets a truncated/failed zip.
    pass.destroy(err);
  });

  // Stream files into the archive sequentially (keeps memory + token use sane).
  (async () => {
    for (const f of files) {
      const built = buildDriveContentFetch(f.id, f.mimeType, "download");
      if ("error" in built) continue; // skip shortcuts / non-streamable
      try {
        const res = await fetch(built.url, {
          headers: { Authorization: `Bearer ${auth.accessToken}` },
        });
        if (!res.ok || !res.body) continue;
        const entryName = adjustName(f.path, built.resultMime);
        // Convert the web ReadableStream to a Node Readable for archiver.
        const nodeStream = webToNode(res.body);
        archive.append(nodeStream, { name: entryName });
        // Wait until this entry is fully consumed before the next fetch.
        await new Promise<void>((resolve) => {
          nodeStream.on("end", resolve);
          nodeStream.on("error", () => resolve());
        });
      } catch {
        // Skip a file that fails; continue with the rest.
      }
    }
    void archive.finalize();
  })();

  const zipName = `${sanitize(rootName)}.zip`;
  return new NextResponse(pass as unknown as ReadableStream, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "Cache-Control": "private, no-store",
    },
  });
}

function errJson(e: unknown) {
  const err = e as Error & { code?: string };
  if (err.code === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
  }
  if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
    return NextResponse.json(
      { error: "Drive access was not granted. Sign out and sign in again." },
      { status: 403 }
    );
  }
  console.error(e);
  return NextResponse.json({ error: err.message || "Folder download failed" }, { status: 500 });
}

/** Strip characters that are unsafe in zip entry names / paths. */
function sanitize(name: string): string {
  return (name || "untitled").replace(/[\\/:*?"<>|]/g, "_").replace(/\.+$/, "").trim() || "untitled";
}

/** Append the exported extension (e.g. Doc→.pdf, Sheet→.xlsx) to the entry. */
function adjustName(path: string, resultMime: string): string {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  return dir + suggestedDownloadName(base, resultMime);
}

/** Adapt a web ReadableStream (fetch body) to a Node Readable for archiver. */
function webToNode(webStream: ReadableStream<Uint8Array>): PassThrough {
  const out = new PassThrough();
  const reader = webStream.getReader();
  (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) out.write(Buffer.from(value));
      }
      out.end();
    } catch (e) {
      out.destroy(e as Error);
    }
  })();
  return out;
}
