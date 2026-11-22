"use client";

import type { AttributeDef, ObjectDef, RecordRow } from "./types";

/** Browser-side helpers for /api/data. Every call returns `{ ok, data | error }` and never throws. */

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status: number; errors?: string[]; existingId?: string; pos?: { start: number; end: number } };

export async function dataApi<T>(url: string, init?: { method?: string; body?: unknown }): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
    // The host answers some failures in plain text (an oversize body, a gateway timeout).
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { ok: false, status: res.status, error: `The server sent an unexpected reply (${res.status}). Try again.` };
    }
    if (!res.ok) {
      const pos = json.pos as { start?: unknown; end?: unknown } | undefined;
      return {
        ok: false,
        status: res.status,
        error: typeof json.error === "string" ? json.error : `Something went wrong (${res.status}).`,
        errors: Array.isArray(json.errors) ? (json.errors as string[]) : undefined,
        existingId: typeof json.existingId === "string" ? json.existingId : undefined,
        pos: pos && typeof pos.start === "number" && typeof pos.end === "number" ? { start: pos.start, end: pos.end } : undefined,
      };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, status: 0, error: "Couldn't reach the server. Check your connection and try again." };
  }
}

export type ObjectWithAttributes = ObjectDef & { attributes: AttributeDef[]; /** What this person may do with it. */ access?: "none" | "read" | "write" };
export type ObjectsResponse = { objects: ObjectWithAttributes[]; canWrite: boolean; isAdmin: boolean; userId?: string };
export type RecordsResponse = { records: RecordRow[]; total: number; page: number; pageSize: number; /** Names behind link and team-member cells, by id. */ names?: Record<string, string> };

/**
 * A small in-memory cache so switching between People, Companies and Deals paints at once from what
 * was loaded a moment ago, and refreshes in the background. Nothing here is trusted as current: a
 * screen always asks again; the cache only decides what shows while it waits.
 */
const CACHE_MAX_AGE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; data: unknown }>();
export function readDataCache<T>(key: string): T | undefined {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < CACHE_MAX_AGE_MS ? (hit.data as T) : undefined;
}
export function writeDataCache(key: string, data: unknown): void {
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), data });
}

/** Forget everything cached. Called after a change so a later tab switch can't show the old values first. */
export function clearDataCache(): void {
  cache.clear();
}

/** The records request a table makes when it first opens. One place builds it so a prefetch and the table agree. */
export function recordsUrl(object: string, opts: { sort?: string; direction?: string; page?: number; pageSize?: number } = {}): string {
  return `/api/data/records?${new URLSearchParams({ object, sort: opts.sort ?? "name", direction: opts.direction ?? "asc", page: String(opts.page ?? 1), pageSize: String(opts.pageSize ?? 50) })}`;
}

/** Load an object's first page ahead of time, so opening its tab is instant. Errors are ignored. */
export async function prefetchRecords(object: string): Promise<void> {
  const url = recordsUrl(object);
  if (readDataCache(url)) return;
  const r = await dataApi<RecordsResponse>(url);
  if (r.ok) writeDataCache(url, r.data);
}

/** How a stored value reads in a table cell. References are resolved separately by the caller. */
export function formatValue(attr: AttributeDef, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((v) => formatValue({ ...attr, is_multi: false }, v)).join(", ");
  switch (attr.type) {
    case "checkbox":
      return value ? "Yes" : "No";
    case "currency":
      return typeof value === "number"
        ? `${attr.config.currency ?? ""} ${value.toLocaleString("en-IN")}`.trim()
        : String(value);
    case "number":
      return typeof value === "number" ? value.toLocaleString("en-IN") : String(value);
    case "date":
      return typeof value === "string" ? new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" }) : String(value);
    case "timestamp":
      return typeof value === "string" ? new Date(value).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : String(value);
    case "rating":
      return typeof value === "number" ? "★".repeat(value) : String(value);
    case "url":
      return typeof value === "string" ? value.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "") : String(value);
    default:
      return String(value);
  }
}
