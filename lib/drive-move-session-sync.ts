import type { DriveListCacheSnapshot } from "@/lib/drive-list-prefetch";
import {
  mergeDriveFileInListOrder,
  parseDriveListCacheSort,
} from "@/lib/drive-list-sort";

type MovePatchFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
  starred?: boolean;
  [key: string]: unknown;
};

function cacheKeyView(key: string): string {
  return key.split("\0")[1] ?? "";
}

function cacheKeyParent(key: string): string {
  return key.split("\0")[0] ?? "";
}

/** Browsable folder trees (My Drive / shared drives) — not Starred / Recent / Shared-with-me. */
function isFolderListingView(view: string): boolean {
  return view === "my-drive" || view === "shared-drive";
}

/**
 * Reflect a move across warmed folder-listing caches only.
 * Starred / Recent / Shared-with-me also use parent `root` — never inject moves there.
 */
export function patchDriveMoveInSessionCache(
  cache: Map<string, DriveListCacheSnapshot>,
  file: MovePatchFile,
  sourceParentId: string,
  destParentId: string
): void {
  const fileId = file.id;

  for (const [key, entry] of Array.from(cache.entries())) {
    const parent = cacheKeyParent(key);
    const view = cacheKeyView(key);
    const files = entry.files as MovePatchFile[];
    const hasFile = files.some((f) => f.id === fileId);

    // Starred is star-based, not parent-based — drop wrongly cached non-starred rows.
    if (view === "starred") {
      if (hasFile && !file.starred) {
        cache.set(key, {
          ...entry,
          files: files.filter((f) => f.id !== fileId),
        });
      }
      continue;
    }

    if (!isFolderListingView(view)) {
      if (view === "recent" && hasFile) {
        cache.set(key, {
          ...entry,
          files: files.filter((f) => f.id !== fileId),
        });
      }
      continue;
    }

    if (parent === sourceParentId && hasFile) {
      cache.set(key, {
        ...entry,
        files: files.filter((f) => f.id !== fileId),
      });
      continue;
    }

    if (parent === destParentId && !hasFile) {
      const { sortKey, sortDir } = parseDriveListCacheSort(key);
      const merged = mergeDriveFileInListOrder(files, file, sortKey, sortDir);
      cache.set(key, { ...entry, files: merged });
    }
  }
}

/** Undo a move in session caches (API failure rollback). */
export function revertDriveMoveInSessionCache(
  cache: Map<string, DriveListCacheSnapshot>,
  file: MovePatchFile,
  sourceParentId: string,
  destParentId: string
): void {
  const fileId = file.id;

  for (const [key, entry] of Array.from(cache.entries())) {
    const parent = cacheKeyParent(key);
    const view = cacheKeyView(key);
    const files = entry.files as MovePatchFile[];
    const hasFile = files.some((f) => f.id === fileId);

    if (view === "starred") continue;

    if (!isFolderListingView(view)) continue;

    if (parent === destParentId && hasFile) {
      cache.set(key, {
        ...entry,
        files: files.filter((f) => f.id !== fileId),
      });
      continue;
    }

    if (parent === sourceParentId && !hasFile) {
      const { sortKey, sortDir } = parseDriveListCacheSort(key);
      const merged = mergeDriveFileInListOrder(files, file, sortKey, sortDir);
      cache.set(key, { ...entry, files: merged });
    }
  }
}
