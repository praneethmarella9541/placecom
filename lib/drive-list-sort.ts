export type DriveListSortableRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
};

export type DriveListSortKey = "name" | "modifiedTime" | "size";
export type DriveListSortDir = "asc" | "desc";

function isFolderRow(row: DriveListSortableRow): boolean {
  return row.mimeType === "application/vnd.google-apps.folder";
}

/** Matches Drive API list order: folders first, then the active sort column. */
export function compareDriveListRows(
  a: DriveListSortableRow,
  b: DriveListSortableRow,
  sortKey: DriveListSortKey | string,
  sortDir: DriveListSortDir
): number {
  const aFolder = isFolderRow(a);
  const bFolder = isFolderRow(b);
  if (aFolder !== bFolder) return aFolder ? -1 : 1;

  let cmp = 0;
  switch (sortKey) {
    case "modifiedTime": {
      const at = new Date(a.modifiedTime ?? 0).getTime();
      const bt = new Date(b.modifiedTime ?? 0).getTime();
      cmp = at - bt;
      break;
    }
    case "size": {
      const as = Number(a.size ?? 0);
      const bs = Number(b.size ?? 0);
      cmp = as - bs;
      break;
    }
    default:
      cmp = a.name.localeCompare(b.name, undefined, {
        numeric: true,
        sensitivity: "base",
      });
  }

  return sortDir === "desc" ? -cmp : cmp;
}

export function sortDriveListRows<T extends DriveListSortableRow>(
  files: readonly T[],
  sortKey: DriveListSortKey | string,
  sortDir: DriveListSortDir
): T[] {
  return [...files].sort((a, b) => compareDriveListRows(a, b, sortKey, sortDir));
}

/** Insert or replace one row while preserving Drive-style sort order. */
export function mergeDriveFileInListOrder<T extends DriveListSortableRow>(
  files: readonly T[],
  file: T,
  sortKey: DriveListSortKey | string,
  sortDir: DriveListSortDir
): T[] {
  const without = files.filter((f) => f.id !== file.id);
  return sortDriveListRows([...without, file], sortKey, sortDir);
}

export function parseDriveListCacheSort(key: string): {
  sortKey: DriveListSortKey | string;
  sortDir: DriveListSortDir;
} {
  const parts = key.split("\0");
  const sortKey = parts[6] || "name";
  const sortDir: DriveListSortDir = parts[7] === "desc" ? "desc" : "asc";
  return { sortKey, sortDir };
}
