import type { DriveListCacheSnapshot } from "@/lib/drive-list-prefetch";

type StarPatchFile = {
  id: string;
  starred?: boolean;
  [key: string]: unknown;
};

function isStarredRootCacheKey(key: string): boolean {
  const [parent, view, , , depthStr] = key.split("\0");
  return view === "starred" && parent === "root" && Number(depthStr) === 0;
}

/** Keep starred flag consistent across all warmed Drive list caches (all sidebar views). */
export function patchDriveStarInSessionCache(
  cache: Map<string, DriveListCacheSnapshot>,
  file: StarPatchFile,
  starred: boolean
): void {
  const fileId = file.id;
  const starredRow = { ...file, starred: true };

  for (const [key, entry] of Array.from(cache.entries())) {
    const files = entry.files as StarPatchFile[];
    const hasFile = files.some((f) => f.id === fileId);

    if (isStarredRootCacheKey(key)) {
      if (starred) {
        if (!hasFile) {
          cache.set(key, { ...entry, files: [starredRow, ...files] });
        } else {
          cache.set(key, {
            ...entry,
            files: files.map((f) => (f.id === fileId ? { ...f, starred: true } : f)),
          });
        }
      } else if (hasFile) {
        cache.set(key, {
          ...entry,
          files: files.filter((f) => f.id !== fileId),
        });
      }
      continue;
    }

    if (hasFile) {
      cache.set(key, {
        ...entry,
        files: files.map((f) => (f.id === fileId ? { ...f, starred } : f)),
      });
    }
  }
}
