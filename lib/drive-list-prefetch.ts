/**
 * Session-scoped cache for Drive file listings (sidebar views at root).
 * Survives navigation within the workspace so prefetched tabs stay warm.
 */

export type DriveListCacheSnapshot = {
  files: unknown[];
  nextPageToken?: string;
};

export type DriveSharedDriveItem = { id: string; name: string };

export type DrivePrefetchView =
  | "my-drive"
  | "shared-with-me"
  | "starred"
  | "recent"
  | "shared-drive";

export type DriveListPrefetchSpec = {
  view: DrivePrefetchView;
  parent: string;
  pathDepth: number;
  sharedDriveId?: string;
};

export const DRIVE_ROOT_PREFETCH_SPECS: readonly DriveListPrefetchSpec[] = [
  { view: "my-drive", parent: "root", pathDepth: 0 },
  { view: "shared-with-me", parent: "root", pathDepth: 0 },
  { view: "starred", parent: "root", pathDepth: 0 },
  { view: "recent", parent: "root", pathDepth: 0 },
] as const;

const DEFAULT_MIME_FILTER = "all";

const SESSION_CACHE = new Map<string, DriveListCacheSnapshot>();
const PREFETCH_IN_FLIGHT = new Set<string>();
let cacheWriteGeneration = 0;
let listMutationEpoch = 0;
let activePrefetchAbort: AbortController | null = null;
let sharedDrivesCache: DriveSharedDriveItem[] | null = null;

/** Bumped on optimistic list mutations (star, move, etc.) so stale fetches skip cache writes. */
export function bumpDriveListMutationEpoch(): void {
  listMutationEpoch += 1;
}

export function getDriveListMutationEpoch(): number {
  return listMutationEpoch;
}

export function getDriveListSessionCache(): Map<string, DriveListCacheSnapshot> {
  return SESSION_CACHE;
}

export function getSharedDrivesSessionCache(): DriveSharedDriveItem[] | null {
  return sharedDrivesCache;
}

export function setSharedDrivesSessionCache(drives: DriveSharedDriveItem[]): void {
  sharedDrivesCache = drives;
}

export function clearDriveListSessionCache(): void {
  SESSION_CACHE.clear();
  sharedDrivesCache = null;
  cacheWriteGeneration += 1;
  activePrefetchAbort?.abort();
  activePrefetchAbort = null;
}

export function buildDriveListCacheKey(parts: {
  parent: string;
  view: string;
  search: string;
  mimeFilter: string;
  pathDepth: number;
  sharedDriveId: string | null;
}): string {
  return [
    parts.parent,
    parts.view,
    parts.search,
    parts.mimeFilter,
    String(parts.pathDepth),
    parts.sharedDriveId ?? "",
  ].join("\0");
}

/** Stable fetch order for list API + pagination; UI sort is applied client-side. */
export function buildDriveFetchOrderBy(view: string, pathDepth: number): string {
  if (pathDepth === 0 && view === "recent") return "viewedByMeTime desc";
  return "folder,name_natural";
}

function buildPrefetchParams(spec: DriveListPrefetchSpec): URLSearchParams {
  const params = new URLSearchParams({
    pageSize: "100",
    parent: spec.parent,
    orderBy: buildDriveFetchOrderBy(spec.view, spec.pathDepth),
  });
  if (
    spec.pathDepth === 0 &&
    (spec.view === "shared-with-me" || spec.view === "starred" || spec.view === "recent")
  ) {
    params.set("view", spec.view);
  }
  if (spec.view === "shared-drive" && spec.sharedDriveId) {
    params.set("sharedDriveId", spec.sharedDriveId);
  }
  return params;
}

function cacheKeyForSpec(spec: DriveListPrefetchSpec): string {
  return buildDriveListCacheKey({
    parent: spec.parent,
    view: spec.view,
    search: "",
    mimeFilter: DEFAULT_MIME_FILTER,
    pathDepth: spec.pathDepth,
    sharedDriveId: spec.sharedDriveId ?? null,
  });
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return;
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]);
    }
  }
  const n = Math.min(Math.max(1, concurrency), items.length);
  await Promise.all(Array.from({ length: n }, () => worker()));
}

async function fetchSharedDrives(signal?: AbortSignal): Promise<DriveSharedDriveItem[]> {
  if (sharedDrivesCache?.length) return sharedDrivesCache;
  try {
    const res = await fetch("/api/drive/drives", { cache: "no-store", signal });
    if (!res.ok) return [];
    const data = (await res.json()) as { drives?: DriveSharedDriveItem[] };
    const drives = data.drives ?? [];
    sharedDrivesCache = drives;
    return drives;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") return [];
    return [];
  }
}

/**
 * Quietly fetch Drive root listings into the session cache (never touches React state).
 */
export async function prefetchDriveListViews(opts?: {
  skipKeys?: ReadonlySet<string>;
  signal?: AbortSignal;
  concurrency?: number;
  force?: boolean;
}): Promise<void> {
  const skip = opts?.skipKeys ?? new Set<string>();
  const concurrency = opts?.concurrency ?? 2;
  const force = opts?.force ?? false;
  const writeGeneration = cacheWriteGeneration;

  const sharedDrives = await fetchSharedDrives(opts?.signal);
  if (opts?.signal?.aborted) return;

  const specs: DriveListPrefetchSpec[] = [...DRIVE_ROOT_PREFETCH_SPECS];
  for (const drive of sharedDrives) {
    specs.push({
      view: "shared-drive",
      parent: drive.id,
      pathDepth: 0,
      sharedDriveId: drive.id,
    });
  }

  const queue = specs
    .map((spec) => ({ spec, cacheKey: cacheKeyForSpec(spec) }))
    .filter(
      ({ cacheKey }) =>
        !skip.has(cacheKey) &&
        (force || !SESSION_CACHE.has(cacheKey)) &&
        !PREFETCH_IN_FLIGHT.has(cacheKey)
    );

  if (queue.length === 0) return;

  await mapWithConcurrency(queue, concurrency, async ({ spec, cacheKey }) => {
    if (opts?.signal?.aborted) return;
    if (SESSION_CACHE.has(cacheKey) || PREFETCH_IN_FLIGHT.has(cacheKey)) return;

    PREFETCH_IN_FLIGHT.add(cacheKey);
    const mutationEpochAtStart = listMutationEpoch;
    try {
      const res = await fetch(`/api/drive/files?${buildPrefetchParams(spec).toString()}`, {
        cache: "no-store",
        signal: opts?.signal,
      });
      if (!res.ok) return;

      const data = (await res.json()) as {
        files?: unknown[];
        nextPageToken?: string;
      };

      if (opts?.signal?.aborted) return;
      if (writeGeneration !== cacheWriteGeneration) return;
      if (mutationEpochAtStart !== listMutationEpoch) return;
      if (!force && SESSION_CACHE.has(cacheKey)) return;

      SESSION_CACHE.set(cacheKey, {
        files: data.files ?? [],
        nextPageToken: data.nextPageToken,
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
    } finally {
      PREFETCH_IN_FLIGHT.delete(cacheKey);
    }
  });
}

/** Warm all standard Drive sidebar views in the background. */
export function startDriveListPrefetchWarm(opts?: {
  skipKeys?: ReadonlySet<string>;
  concurrency?: number;
}): void {
  activePrefetchAbort?.abort();
  const ac = new AbortController();
  activePrefetchAbort = ac;
  void prefetchDriveListViews({
    skipKeys: opts?.skipKeys,
    signal: ac.signal,
    concurrency: opts?.concurrency ?? 2,
    force: false,
  });
}
