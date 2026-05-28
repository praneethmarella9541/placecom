import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  getDriveFileMeta,
  listFolderChildren,
} from "@/lib/drive";
import { buildDriveContentFetch, suggestedDownloadName } from "@/lib/drive-file-proxy";

export const runtime = "nodejs";
export const maxDuration = 300;

const FOLDER_MIME = "application/vnd.google-apps.folder";
const MAX_FILES = 1000;
const MAX_DEPTH = 25;

type Entry = { id: string; name: string; mimeType: string; path: string };

// Precomputed CRC-32 lookup table (IEEE polynomial 0xEDB88320). The ZIP
// format requires a valid CRC-32 of each entry's uncompressed bytes;
// unzip tools (notably macOS Archive Utility) reject archives whose stored
// CRC doesn't match the data, which is why a hardcoded 0 produced corrupt zips.
const CRC_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

class ZipWriter {
  private files: Buffer[] = [];
  private offset = 0;
  private centralDir: Buffer[] = [];
  private fileHeaders: Array<{ offset: number; header: Buffer }> = [];

  async addFile(name: string, data: Buffer) {
    const crc = crc32(data);
    const localOffset = this.offset;
    const header = this.createLocalFileHeader(name, data.length, crc);

    this.fileHeaders.push({ offset: localOffset, header });
    this.files.push(header, data);
    this.offset += header.length + data.length;

    const centralEntry = this.createCentralDirectory(name, data.length, crc, localOffset);
    this.centralDir.push(centralEntry);
  }

  private createLocalFileHeader(name: string, dataSize: number, crc: number): Buffer {
    const nameBuf = Buffer.from(name, "utf8");
    const buf = Buffer.alloc(30 + nameBuf.length);
    let offset = 0;

    buf.writeUInt32LE(0x04034b50, offset); offset += 4; // local file header signature
    buf.writeUInt16LE(20, offset); offset += 2; // version needed to extract
    buf.writeUInt16LE(0, offset); offset += 2; // general purpose bit flag
    buf.writeUInt16LE(0, offset); offset += 2; // compression method (0 = no compression)
    buf.writeUInt16LE(0, offset); offset += 2; // last mod file time
    buf.writeUInt16LE(0, offset); offset += 2; // last mod file date
    buf.writeUInt32LE(crc, offset); offset += 4; // crc-32
    buf.writeUInt32LE(dataSize, offset); offset += 4; // compressed size
    buf.writeUInt32LE(dataSize, offset); offset += 4; // uncompressed size
    buf.writeUInt16LE(nameBuf.length, offset); offset += 2; // file name length
    buf.writeUInt16LE(0, offset); offset += 2; // extra field length

    nameBuf.copy(buf, offset);
    return buf;
  }

  private createCentralDirectory(name: string, dataSize: number, crc: number, localHeaderOffset: number): Buffer {
    const nameBuf = Buffer.from(name, "utf8");
    const buf = Buffer.alloc(46 + nameBuf.length);
    let offset = 0;

    buf.writeUInt32LE(0x02014b50, offset); offset += 4; // central file header signature
    buf.writeUInt16LE(20, offset); offset += 2; // version made by
    buf.writeUInt16LE(20, offset); offset += 2; // version needed to extract
    buf.writeUInt16LE(0, offset); offset += 2; // general purpose bit flag
    buf.writeUInt16LE(0, offset); offset += 2; // compression method
    buf.writeUInt16LE(0, offset); offset += 2; // last mod file time
    buf.writeUInt16LE(0, offset); offset += 2; // last mod file date
    buf.writeUInt32LE(crc, offset); offset += 4; // crc-32
    buf.writeUInt32LE(dataSize, offset); offset += 4; // compressed size
    buf.writeUInt32LE(dataSize, offset); offset += 4; // uncompressed size
    buf.writeUInt16LE(nameBuf.length, offset); offset += 2; // file name length
    buf.writeUInt16LE(0, offset); offset += 2; // extra field length
    buf.writeUInt16LE(0, offset); offset += 2; // file comment length
    buf.writeUInt16LE(0, offset); offset += 2; // disk number start
    buf.writeUInt16LE(0, offset); offset += 2; // internal file attributes
    buf.writeUInt32LE(0, offset); offset += 4; // external file attributes
    buf.writeUInt32LE(localHeaderOffset, offset); offset += 4; // relative offset of local header

    nameBuf.copy(buf, offset);
    return buf;
  }

  getBuffer(): Buffer {
    const centralDirStart = this.offset;
    const centralDirBuf = Buffer.concat(this.centralDir);

    const endOfCentralDir = Buffer.alloc(22);
    let offset = 0;
    endOfCentralDir.writeUInt32LE(0x06054b50, offset); offset += 4; // end of central directory signature
    endOfCentralDir.writeUInt16LE(0, offset); offset += 2; // disk number
    endOfCentralDir.writeUInt16LE(0, offset); offset += 2; // disk with central directory
    endOfCentralDir.writeUInt16LE(this.centralDir.length, offset); offset += 2; // entries on this disk
    endOfCentralDir.writeUInt16LE(this.centralDir.length, offset); offset += 2; // total entries
    endOfCentralDir.writeUInt32LE(centralDirBuf.length, offset); offset += 4; // central directory size
    endOfCentralDir.writeUInt32LE(centralDirStart, offset); offset += 4; // central directory offset
    endOfCentralDir.writeUInt16LE(0, offset); // comment length

    return Buffer.concat([...this.files, centralDirBuf, endOfCentralDir]);
  }
}

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

  const zip = new ZipWriter();
  const usedNames = new Set<string>();

  for (const f of files) {
    const built = buildDriveContentFetch(f.id, f.mimeType, "download");
    if ("error" in built) continue;
    try {
      const res = await fetch(built.url, {
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      if (!res.ok || !res.body) continue;

      const chunks: Uint8Array[] = [];
      const reader = res.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }

      const data = Buffer.concat(chunks.map(c => Buffer.from(c)));
      const entryName = dedupeName(adjustName(f.path, built.resultMime), usedNames);
      await zip.addFile(entryName, data);
    } catch {
      // Skip failed files
    }
  }

  const zipBuffer = zip.getBuffer();
  const zipName = `${sanitize(rootName)}.zip`;

  // Buffer is a valid response body at runtime; the cast sidesteps a spurious
  // Buffer<ArrayBufferLike> vs BodyInit mismatch from @types/node version drift.
  return new NextResponse(zipBuffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(zipName)}`,
      "Cache-Control": "private, no-store",
      "Content-Length": zipBuffer.length.toString(),
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

function sanitize(name: string): string {
  return (name || "untitled").replace(/[\\/:*?"<>|]/g, "_").replace(/\.+$/, "").trim() || "untitled";
}

function adjustName(path: string, resultMime: string): string {
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash + 1) : "";
  const base = slash >= 0 ? path.slice(slash + 1) : path;
  return dir + suggestedDownloadName(base, resultMime);
}

/**
 * Ensure each zip entry path is unique. Two files in the same folder can
 * collide after export-mime normalization (e.g. two Google Docs both become
 * "report.pdf"); duplicate paths make some unzip tools drop or error on
 * entries, so we append " (2)", " (3)", … before the extension.
 */
function dedupeName(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const slash = name.lastIndexOf("/");
  const hasExt = dot > slash && dot !== -1;
  const stem = hasExt ? name.slice(0, dot) : name;
  const ext = hasExt ? name.slice(dot) : "";
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}
