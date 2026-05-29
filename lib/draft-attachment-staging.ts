import "server-only";

import { createServiceSupabase } from "@/lib/supabase-service";
import { randomUUID } from "crypto";
import fs from "fs/promises";
import path from "path";

const TTL_MS = 20 * 60 * 1000;
const TMP_ROOT = path.join("/tmp", "placecom-draft-staging");
const STORAGE_BUCKET = "draft-attachment-staging";

let bucketEnsure: Promise<void> | null = null;

function ensureStagingBucket(): Promise<void> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return Promise.resolve();
  }
  if (!bucketEnsure) {
    bucketEnsure = (async () => {
      const supabase = createServiceSupabase();
      await supabase.storage.createBucket(STORAGE_BUCKET, { public: false });
    })().catch(() => {});
  }
  return bucketEnsure;
}

type StagedMeta = {
  userId: string;
  filename: string;
  mimeType: string;
  totalSize: number;
  received: number;
  createdAt: number;
};

/** In-process cache — same Lambda instance as chunk upload + draft save. */
const memStore = new Map<string, StagedMeta & { chunks: Buffer[] }>();

function safeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function dirFor(userId: string, uploadId: string): string {
  return path.join(TMP_ROOT, safeSegment(userId), safeSegment(uploadId));
}

function metaFilePath(userId: string, uploadId: string): string {
  return path.join(dirFor(userId, uploadId), "meta.json");
}

function dataFilePath(userId: string, uploadId: string): string {
  return path.join(dirFor(userId, uploadId), "data.bin");
}

function storagePrefix(userId: string, uploadId: string): string {
  return `${safeSegment(userId)}/${safeSegment(uploadId)}`;
}

function pruneMem() {
  const now = Date.now();
  memStore.forEach((entry, id) => {
    if (now - entry.createdAt > TTL_MS) memStore.delete(id);
  });
}

async function pruneDisk() {
  const now = Date.now();
  let users: string[];
  try {
    users = await fs.readdir(TMP_ROOT);
  } catch {
    return;
  }
  for (const userDir of users) {
    const userPath = path.join(TMP_ROOT, userDir);
    let sessions: string[];
    try {
      sessions = await fs.readdir(userPath);
    } catch {
      continue;
    }
    for (const session of sessions) {
      const metaPath = path.join(userPath, session, "meta.json");
      try {
        const raw = await fs.readFile(metaPath, "utf8");
        const meta = JSON.parse(raw) as StagedMeta;
        if (now - meta.createdAt > TTL_MS) {
          await fs.rm(path.join(userPath, session), { recursive: true, force: true });
        }
      } catch {
        await fs.rm(path.join(userPath, session), { recursive: true, force: true }).catch(() => {});
      }
    }
  }
}

async function writeMetaDisk(meta: StagedMeta, uploadId: string): Promise<void> {
  const dir = dirFor(meta.userId, uploadId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "meta.json"), JSON.stringify(meta));
}

async function readMetaDisk(userId: string, uploadId: string): Promise<StagedMeta | null> {
  try {
    const raw = await fs.readFile(metaFilePath(userId, uploadId), "utf8");
    return JSON.parse(raw) as StagedMeta;
  } catch {
    return null;
  }
}

async function supabaseUploadPart(
  userId: string,
  uploadId: string,
  offset: number,
  chunk: Buffer
): Promise<void> {
  await ensureStagingBucket();
  const supabase = createServiceSupabase();
  const objectPath = `${storagePrefix(userId, uploadId)}/${String(offset).padStart(12, "0")}.part`;
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, chunk, {
    upsert: true,
    contentType: "application/octet-stream",
  });
  if (error) throw new Error(error.message);
}

async function supabaseWriteMeta(userId: string, uploadId: string, meta: StagedMeta): Promise<void> {
  const supabase = createServiceSupabase();
  const objectPath = `${storagePrefix(userId, uploadId)}/meta.json`;
  const body = Buffer.from(JSON.stringify(meta));
  const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(objectPath, body, {
    upsert: true,
    contentType: "application/json",
  });
  if (error) throw new Error(error.message);
}

async function supabaseReadMeta(userId: string, uploadId: string): Promise<StagedMeta | null> {
  const supabase = createServiceSupabase();
  const objectPath = `${storagePrefix(userId, uploadId)}/meta.json`;
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(objectPath);
  if (error || !data) return null;
  try {
    return JSON.parse(await data.text()) as StagedMeta;
  } catch {
    return null;
  }
}

async function supabaseReadFile(userId: string, uploadId: string, totalSize: number): Promise<Buffer | null> {
  const supabase = createServiceSupabase();
  const prefix = storagePrefix(userId, uploadId);
  const { data: listed, error: listErr } = await supabase.storage.from(STORAGE_BUCKET).list(prefix);
  if (listErr || !listed?.length) return null;

  const parts = listed
    .filter((f) => f.name?.endsWith(".part"))
    .map((f) => ({
      offset: parseInt(f.name!.replace(".part", ""), 10),
      name: f.name!,
    }))
    .filter((p) => Number.isFinite(p.offset))
    .sort((a, b) => a.offset - b.offset);

  if (parts.length === 0) return null;

  const out = Buffer.alloc(totalSize);
  let written = 0;
  for (const part of parts) {
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .download(`${prefix}/${part.name}`);
    if (error || !data) return null;
    const buf = Buffer.from(await data.arrayBuffer());
    buf.copy(out, part.offset);
    written = Math.max(written, part.offset + buf.length);
  }
  if (written < totalSize) return null;
  return out;
}

async function supabaseRemove(userId: string, uploadId: string): Promise<void> {
  const supabase = createServiceSupabase();
  const prefix = storagePrefix(userId, uploadId);
  const { data: listed } = await supabase.storage.from(STORAGE_BUCKET).list(prefix);
  if (!listed?.length) return;
  const paths = listed.map((f) => `${prefix}/${f.name}`);
  await supabase.storage.from(STORAGE_BUCKET).remove(paths);
}

export function createStagedUpload(
  userId: string,
  filename: string,
  mimeType: string,
  totalSize: number
): string {
  pruneMem();
  void pruneDisk();
  const id = randomUUID();
  const meta: StagedMeta = {
    userId,
    filename,
    mimeType,
    totalSize,
    received: 0,
    createdAt: Date.now(),
  };
  memStore.set(id, { ...meta, chunks: [] });
  void writeMetaDisk(meta, id).catch(() => {});
  void supabaseWriteMeta(userId, id, meta).catch(() => {});
  return id;
}

const supabaseConfigured = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Append a chunk. The durable copy (Supabase, or local disk when Supabase is
 * not configured) is written *and awaited* before this resolves, so a caller
 * that sees `done: true` is guaranteed the bytes are readable from another
 * serverless instance via {@link getStagedAttachment}. Awaiting the durable
 * write is what makes cross-instance draft saves reliable for 3–25 MB files —
 * previously the upload was fire-and-forget and the draft save could race it.
 */
export async function appendStagedChunk(
  userId: string,
  uploadId: string,
  offset: number,
  chunk: Buffer
): Promise<{ done: boolean; received: number }> {
  pruneMem();
  const entry = memStore.get(uploadId);
  if (!entry || entry.userId !== userId) {
    throw new Error("Upload session not found");
  }
  if (offset !== entry.received) {
    throw new Error("Unexpected chunk offset");
  }
  entry.chunks.push(chunk);
  entry.received += chunk.length;

  const meta: StagedMeta = {
    userId: entry.userId,
    filename: entry.filename,
    mimeType: entry.mimeType,
    totalSize: entry.totalSize,
    received: entry.received,
    createdAt: entry.createdAt,
  };
  const done = entry.received >= entry.totalSize;

  const dir = dirFor(userId, uploadId);
  const writeDisk = async () => {
    await fs.mkdir(dir, { recursive: true });
    const handle = await fs.open(dataFilePath(userId, uploadId), offset === 0 ? "w" : "r+");
    try {
      await handle.write(chunk, 0, chunk.length, offset);
    } finally {
      await handle.close();
    }
    await writeMetaDisk(meta, uploadId);
  };

  if (supabaseConfigured) {
    // Await the durable (cross-instance) write so completion is authoritative.
    // Throwing here surfaces as a chunk-upload failure the client can retry.
    await supabaseUploadPart(userId, uploadId, offset, chunk);
    await supabaseWriteMeta(userId, uploadId, meta);
    // Local disk is just a same-instance fast path here — best-effort.
    void writeDisk().catch(() => {});
  } else if (done) {
    // No Supabase: local disk is the only durable store. Flush the final chunk
    // before reporting done so a same-instance save can read it.
    await writeDisk();
  } else {
    void writeDisk().catch(() => {});
  }

  return { done, received: entry.received };
}

async function loadCompleteBuffer(
  userId: string,
  uploadId: string,
  meta: StagedMeta
): Promise<Buffer | null> {
  const mem = memStore.get(uploadId);
  if (mem && mem.received >= meta.totalSize && mem.chunks.length > 0) {
    return Buffer.concat(mem.chunks);
  }

  try {
    const data = await fs.readFile(dataFilePath(userId, uploadId));
    if (data.length >= meta.totalSize) return data;
  } catch {
    /* try supabase */
  }

  try {
    return await supabaseReadFile(userId, uploadId, meta.totalSize);
  } catch {
    return null;
  }
}

async function resolveMeta(userId: string, uploadId: string): Promise<StagedMeta | null> {
  const mem = memStore.get(uploadId);
  if (mem && mem.userId === userId) {
    return {
      userId: mem.userId,
      filename: mem.filename,
      mimeType: mem.mimeType,
      totalSize: mem.totalSize,
      received: mem.received,
      createdAt: mem.createdAt,
    };
  }
  const disk = await readMetaDisk(userId, uploadId);
  if (disk && disk.userId === userId) return disk;
  return supabaseReadMeta(userId, uploadId);
}

/** Read staged bytes without deleting — safe if autosave runs twice before release. */
export async function getStagedAttachment(
  userId: string,
  uploadId: string
): Promise<{ filename: string; mimeType: string; base64Data: string } | null> {
  pruneMem();

  // The chunk endpoint awaits the durable write before reporting done, but
  // Supabase storage can still be briefly read-after-write inconsistent across
  // instances. Retry a few times before giving up so a save that arrives right
  // after the final chunk doesn't spuriously fail.
  const attempts = 5;
  for (let i = 0; i < attempts; i++) {
    const meta = await resolveMeta(userId, uploadId);
    if (meta && meta.userId === userId && meta.received >= meta.totalSize) {
      const buf = await loadCompleteBuffer(userId, uploadId, meta);
      if (buf && buf.length >= meta.totalSize) {
        return {
          filename: meta.filename,
          mimeType: meta.mimeType,
          base64Data: buf.toString("base64"),
        };
      }
    }
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, 300));
  }

  return null;
}

/** Remove staging data after Gmail draft save succeeds. */
export async function releaseStagedAttachments(userId: string, uploadIds: string[]): Promise<void> {
  for (const uploadId of uploadIds) {
    memStore.delete(uploadId);
    await fs.rm(dirFor(userId, uploadId), { recursive: true, force: true }).catch(() => {});
    await supabaseRemove(userId, uploadId).catch(() => {});
  }
}

/** @deprecated Use getStagedAttachment — kept for compatibility. */
export async function takeStagedAttachment(
  userId: string,
  uploadId: string
): Promise<{ filename: string; mimeType: string; base64Data: string } | null> {
  const att = await getStagedAttachment(userId, uploadId);
  if (att) await releaseStagedAttachments(userId, [uploadId]);
  return att;
}

export function discardStagedUpload(userId: string, uploadId: string) {
  void releaseStagedAttachments(userId, [uploadId]);
}
