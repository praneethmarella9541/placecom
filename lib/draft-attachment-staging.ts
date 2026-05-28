import "server-only";

import { randomUUID } from "crypto";

const TTL_MS = 20 * 60 * 1000;

type StagedFile = {
  userId: string;
  filename: string;
  mimeType: string;
  totalSize: number;
  received: number;
  chunks: Buffer[];
  createdAt: number;
};

const store = new Map<string, StagedFile>();

function prune() {
  const now = Date.now();
  store.forEach((entry, id) => {
    if (now - entry.createdAt > TTL_MS) store.delete(id);
  });
}

export function createStagedUpload(userId: string, filename: string, mimeType: string, totalSize: number) {
  prune();
  const id = randomUUID();
  store.set(id, {
    userId,
    filename,
    mimeType,
    totalSize,
    received: 0,
    chunks: [],
    createdAt: Date.now(),
  });
  return id;
}

export function appendStagedChunk(
  userId: string,
  uploadId: string,
  offset: number,
  chunk: Buffer
): { done: boolean; received: number } {
  prune();
  const entry = store.get(uploadId);
  if (!entry || entry.userId !== userId) {
    throw new Error("Upload session not found");
  }
  if (offset !== entry.received) {
    throw new Error("Unexpected chunk offset");
  }
  entry.chunks.push(chunk);
  entry.received += chunk.length;
  const done = entry.received >= entry.totalSize;
  return { done, received: entry.received };
}

export function takeStagedAttachment(
  userId: string,
  uploadId: string
): { filename: string; mimeType: string; base64Data: string } | null {
  prune();
  const entry = store.get(uploadId);
  if (!entry || entry.userId !== userId) return null;
  if (entry.received < entry.totalSize) return null;
  const base64Data = Buffer.concat(entry.chunks).toString("base64");
  store.delete(uploadId);
  return {
    filename: entry.filename,
    mimeType: entry.mimeType,
    base64Data,
  };
}

export function discardStagedUpload(userId: string, uploadId: string) {
  const entry = store.get(uploadId);
  if (entry?.userId === userId) store.delete(uploadId);
}
