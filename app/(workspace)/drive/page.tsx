"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { Upload } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import {
  IconSearch,
  IconRefresh,
  IconFolder,
  IconChevronRight,
  IconDownload,
  IconX,
} from "@/components/Icons";
import { supportsInAppPreview, isOfficeMimeType } from "@/lib/drive-file-proxy";
import { DriveShareModal } from "@/components/DriveShareModal";
import { DriveMoveModal } from "@/components/DriveMoveModal";
import { DriveDetailsPanel } from "@/components/DriveDetailsPanel";
import { DriveUploadQueue, type UploadQueueItem } from "@/components/DriveUploadQueue";
import { DriveMimeIcon } from "@/lib/drive-mime-icon";
import {
  driveUploadResultToRow,
  uploadFileToDriveFolder,
} from "@/lib/upload-file-to-drive-folder";
import {
  Share2,
  HardDrive,
  Users,
  Star,
  FolderPlus,
  MoreVertical,
  Pencil,
  FolderInput,
  ArrowUp,
  ArrowDown,
  FileUp,
  FolderUp,
  ChevronDown,
  LayoutGrid,
  List,
  Loader2,
  Clock,
  Copy,
  Info,
  Menu,
  Filter,
} from "lucide-react";

const DRIVE_SIMPLE_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;

type DriveView = "my-drive" | "shared-with-me" | "starred" | "recent";
type SharedDrive = { id: string; name: string };
type MimeFilter =
  | "all"
  | "folders"
  | "documents"
  | "spreadsheets"
  | "images"
  | "videos"
  | "pdfs";

type DriveFileRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
  starred?: boolean;
  thumbnailLink?: string;
  iconLink?: string;
  location?: {
    folderId: string;
    label: string;
    view: "my-drive" | "shared-drive" | "shared-with-me";
    sharedDriveId?: string;
    path: Array<{ id: string; name: string }>;
  };
};

type RowContextMenu = { x: number; y: number; file: DriveFileRow };

function matchesMimeFilter(file: DriveFileRow, filter: MimeFilter): boolean {
  const m = file.mimeType;
  switch (filter) {
    case "all":
      return true;
    case "folders":
      return m === "application/vnd.google-apps.folder";
    case "documents":
      return (
        m.includes("document") ||
        m.includes("word") ||
        m.startsWith("text/")
      );
    case "spreadsheets":
      return m.includes("spreadsheet") || m.includes("excel");
    case "images":
      return m.startsWith("image/");
    case "videos":
      return m.startsWith("video/");
    case "pdfs":
      return m === "application/pdf";
    default:
      return true;
  }
}

type PathCrumb = { id: string; name: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type DriveListCacheEntry = { files: DriveFileRow[]; nextPageToken?: string };

function driveListCacheKey(parts: {
  parent: string;
  view: string;
  search: string;
  mimeFilter: MimeFilter;
  pathDepth: number;
  sharedDriveId: string | null;
  sortKey: string;
  sortDir: string;
}): string {
  return [
    parts.parent,
    parts.view,
    parts.search,
    parts.mimeFilter,
    String(parts.pathDepth),
    parts.sharedDriveId ?? "",
    parts.sortKey,
    parts.sortDir,
  ].join("\0");
}

type SortKey = "name" | "modifiedTime" | "size";

/** Maps UI sort to Drive API orderBy (folders first where applicable). */
function buildDriveOrderBy(
  sortKey: SortKey,
  sortDir: "asc" | "desc",
  view: DriveView | "shared-drive",
  pathDepth: number
): string {
  if (pathDepth === 0 && view === "recent") return "viewedByMeTime desc";
  const dir = sortDir === "desc" ? " desc" : "";
  switch (sortKey) {
    case "modifiedTime":
      return `folder,modifiedTime${dir}`;
    case "size":
      return `folder,quotaBytesUsed${dir}`;
    default:
      return `folder,name_natural${dir}`;
  }
}

export default function DrivePage() {
  /** Top-level sidebar selection. "shared-drive" is internal — the actual
   *  drive id is held separately in currentSharedDrive. */
  const [view, setView] = useState<DriveView | "shared-drive">("my-drive");
  /** When view === "shared-drive", which drive's contents we're listing. */
  const [currentSharedDrive, setCurrentSharedDrive] = useState<SharedDrive | null>(null);

  /** List of shared drives the user has access to — populates the sidebar. */
  const [sharedDrives, setSharedDrives] = useState<SharedDrive[]>([]);

  /** Folder path from the current view root; empty = at the root. */
  const [pathStack, setPathStack] = useState<PathCrumb[]>([]);
  // Effective parent id sent to the API:
  //   - In a shared-drive view at root, use the driveId as parentId.
  //   - Otherwise, last folder on the stack, or "root" for the top of a view.
  const currentParentId =
    pathStack.length > 0
      ? pathStack[pathStack.length - 1].id
      : view === "shared-drive" && currentSharedDrive
        ? currentSharedDrive.id
        : "root";

  const [driveFiles, setDriveFiles] = useState<DriveFileRow[]>([]);
  const [driveNextPageToken, setDriveNextPageToken] = useState<string | undefined>();
  const [loadingDrive, setLoadingDrive] = useState(true);
  const [refreshingDrive, setRefreshingDrive] = useState(false);
  const driveFilesRef = useRef<DriveFileRow[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false); // stable for the IntersectionObserver
  const listScrollRef = useRef<HTMLUListElement>(null);
  const loadMoreSentinelRef = useRef<HTMLLIElement>(null);
  const driveListCacheRef = useRef<Map<string, DriveListCacheEntry>>(new Map());
  const driveListInflightRef = useRef<Map<string, Promise<DriveListCacheEntry>>>(new Map());
  const activeDriveListLoadRef = useRef<string | null>(null);
  const [driveListError, setDriveListError] = useState<string | null>(null);
  const [driveSearchInput, setDriveSearchInput] = useState("");
  const [driveSearch, setDriveSearch] = useState("");

  const [previewFile, setPreviewFile] = useState<DriveFileRow | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // Target file/folder for the share modal — null means modal closed.
  const [shareTarget, setShareTarget] = useState<DriveFileRow | null>(null);
  // Target file/folder for the move modal.
  const [moveTarget, setMoveTarget] = useState<DriveFileRow | null>(null);
  const [detailsFileId, setDetailsFileId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<RowContextMenu | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mimeFilter, setMimeFilter] = useState<MimeFilter>("all");
  const [isDragOver, setIsDragOver] = useState(false);
  // Inline-rename target id + the value being typed.
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Row-action menu (kebab) open state — keyed by file id.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // List vs. grid layout (persisted to localStorage). Mirrors Google Drive.
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("drive-view-mode") : null;
    if (saved === "grid" || saved === "list") setViewMode(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("drive-view-mode", viewMode);
  }, [viewMode]);
  // "New folder" modal state.
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  // Sort column + direction — passed to Drive API orderBy (not re-sorted client-side).
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  useEffect(() => {
    const sk = typeof window !== "undefined" ? localStorage.getItem("drive-sort-key") : null;
    const sd = typeof window !== "undefined" ? localStorage.getItem("drive-sort-dir") : null;
    if (sk === "name" || sk === "modifiedTime" || sk === "size") setSortKey(sk);
    if (sd === "asc" || sd === "desc") setSortDir(sd);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("drive-sort-key", sortKey);
      localStorage.setItem("drive-sort-dir", sortDir);
    }
  }, [sortKey, sortDir]);
  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  // IDs of files/folders currently being downloaded — drives the spinner
  // and bottom toast so the user knows the request is in flight.
  const [downloadingIds, setDownloadingIds] = useState<Set<string>>(new Set());
  const [uploadBusy, setUploadBusy] = useState(false);

  type StorageQuota = { limit?: string; usage?: string; usageInDrive?: string; usageInDriveTrash?: string };
  const [storageQuota, setStorageQuota] = useState<StorageQuota | null>(null);

  useEffect(() => {
    fetch("/api/drive/about", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((q: StorageQuota | null) => { if (q) setStorageQuota(q); })
      .catch(() => {});
  }, []);

  // Per-item upload queue, mirroring Google Drive's bottom-right status card.
  // Each file/folder gets a row with a live status; the old single-line
  // progress banner is replaced by the DriveUploadQueue popup.
  const [uploadQueue, setUploadQueue] = useState<UploadQueueItem[]>([]);
  // Upload-button dropdown ("File upload" / "Folder upload") open state.
  const [uploadMenuOpen, setUploadMenuOpen] = useState(false);

  /** Patch a single queue item by id (status / error). */
  const updateQueueItem = useCallback(
    (id: string, patch: Partial<UploadQueueItem>) => {
      setUploadQueue((q) => q.map((it) => (it.id === id ? { ...it, ...patch } : it)));
    },
    []
  );

  useEffect(() => {
    driveFilesRef.current = driveFiles;
  }, [driveFiles]);

  useEffect(() => {
    const t = setTimeout(() => setDriveSearch(driveSearchInput.trim()), 200);
    return () => clearTimeout(t);
  }, [driveSearchInput]);

  const previewFileId = previewFile?.id ?? null;

  useEffect(() => {
    if (!previewFileId) {
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    const t = setTimeout(() => setPreviewLoading(false), 45_000);
    return () => clearTimeout(t);
  }, [previewFileId]);

  // Load the user's shared drives once on mount so the sidebar can list
  // them. Non-fatal on error (some accounts simply have none).
  useEffect(() => {
    let cancelled = false;
    // no-store: shared drives appear immediately when the user first lands on
    // the page — avoids the 60s browser cache hiding a newly-shared drive.
    fetch("/api/drive/drives", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { drives?: SharedDrive[] } | null) => {
        if (cancelled || !j?.drives) return;
        setSharedDrives(j.drives);
      })
      .catch(() => {/* no shared drives is fine */});
    return () => { cancelled = true; };
  }, []);

  /** Switch the top-level view. Resets folder path + search so the user
   *  always lands at the view root, matching Google Drive behaviour. */
  function switchView(next: DriveView, drive?: SharedDrive) {
    if (next === "my-drive") {
      setView("my-drive");
      setCurrentSharedDrive(null);
    } else {
      setView(next);
      setCurrentSharedDrive(null);
    }
    setPathStack([]);
    beginFolderNavigation();
    setDriveSearchInput("");
    setDriveSearch("");
    // `drive` param only relevant when caller is selecting a shared drive
    // via switchSharedDrive — switchView itself just handles my-drive /
    // shared-with-me / starred.
    void drive;
  }

  /** Enter a shared drive — special case because the drive id becomes the
   *  effective parentId for the file listing. */
  function switchSharedDrive(drive: SharedDrive) {
    setView("shared-drive");
    setCurrentSharedDrive(drive);
    setPathStack([]);
    beginFolderNavigation();
    setDriveSearchInput("");
    setDriveSearch("");
  }

  /** Open the folder that contains a Recent item (Google Drive Location column). */
  function openFileLocation(loc: NonNullable<DriveFileRow["location"]>) {
    setDriveSearchInput("");
    setDriveSearch("");
    beginFolderNavigation();
    setPreviewFile(null);
    if (loc.view === "shared-drive" && loc.sharedDriveId) {
      const drive =
        sharedDrives.find((d) => d.id === loc.sharedDriveId) ??
        ({ id: loc.sharedDriveId, name: loc.label } satisfies SharedDrive);
      setView("shared-drive");
      setCurrentSharedDrive(drive);
      setPathStack(loc.path);
      return;
    }
    if (loc.view === "shared-with-me") {
      setView("shared-with-me");
      setCurrentSharedDrive(null);
      setPathStack(loc.path);
      return;
    }
    setView("my-drive");
    setCurrentSharedDrive(null);
    setPathStack(loc.path);
  }

  const showLocationColumn =
    (view === "recent" && pathStack.length === 0) || !!driveSearch;

  const sharedDriveIdForApi =
    view === "shared-drive" && currentSharedDrive ? currentSharedDrive.id : null;

  const driveListContextKey = useMemo(
    () =>
      driveListCacheKey({
        parent: currentParentId,
        view,
        search: driveSearch,
        mimeFilter,
        pathDepth: pathStack.length,
        sharedDriveId: sharedDriveIdForApi,
        sortKey,
        sortDir,
      }),
    [
      currentParentId,
      view,
      driveSearch,
      mimeFilter,
      pathStack.length,
      sharedDriveIdForApi,
      sortKey,
      sortDir,
    ]
  );

  /** Keep session cache in sync with optimistic list mutations (upload/move/etc.). */
  const syncDriveListCache = useCallback(
    (updater: (files: DriveFileRow[]) => DriveFileRow[]) => {
      setDriveFiles((prev) => {
        const next = updater(prev);
        const token = driveListCacheRef.current.get(driveListContextKey)?.nextPageToken;
        driveListCacheRef.current.set(driveListContextKey, {
          files: next,
          nextPageToken: token,
        });
        return next;
      });
    },
    [driveListContextKey]
  );

  const buildFilesListParams = useCallback(
    (parent: string, pathDepth: number, pageToken?: string) => {
      const params = new URLSearchParams({
        pageSize: "100",
        parent,
      });
      if (pageToken) params.set("pageToken", pageToken);
      if (driveSearch) params.set("search", driveSearch);
      if (!driveSearch) {
        params.set(
          "orderBy",
          buildDriveOrderBy(sortKey, sortDir, view, pathDepth)
        );
      }
      if (
        !driveSearch &&
        pathDepth === 0 &&
        (view === "shared-with-me" || view === "starred" || view === "recent")
      ) {
        params.set("view", view);
      }
      if (mimeFilter === "folders") {
        params.set("mimeType", "application/vnd.google-apps.folder");
      }
      if (view === "shared-drive" && currentSharedDrive) {
        params.set("sharedDriveId", currentSharedDrive.id);
      }
      return params;
    },
    [driveSearch, view, mimeFilter, currentSharedDrive, sortKey, sortDir]
  );

  const fetchDriveListPage = useCallback(
    async (
      parent: string,
      pathDepth: number,
      pageToken?: string,
      bust?: boolean
    ): Promise<DriveListCacheEntry> => {
      const cacheKey = driveListCacheKey({
        parent,
        view,
        search: driveSearch,
        mimeFilter,
        pathDepth,
        sharedDriveId: sharedDriveIdForApi,
        sortKey,
        sortDir,
      });
      const inflightKey = `${cacheKey}\0${pageToken ?? ""}`;
      if (!bust) {
        const cached = driveListCacheRef.current.get(cacheKey);
        if (cached && !pageToken) return cached;
        const inflight = driveListInflightRef.current.get(inflightKey);
        if (inflight) return inflight;
      }

      const params = buildFilesListParams(parent, pathDepth, pageToken);
      const promise = fetch(
        `/api/drive/files?${params.toString()}`,
        bust || driveSearch ? { cache: "no-store" } : undefined
      ).then(async (res) => {
        const raw = await res.text();
        let data: { error?: string; files?: DriveFileRow[]; nextPageToken?: string } = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(
            res.status === 401 || res.status === 403
              ? "Sign-in needed for Drive. Please refresh or sign in again."
              : `Drive request failed (${res.status}). Please try again.`
          );
        }
        if (!res.ok) throw new Error(data.error || `Failed to load Drive (${res.status})`);
        const entry: DriveListCacheEntry = {
          files: data.files || [],
          nextPageToken: data.nextPageToken,
        };
        if (!pageToken) driveListCacheRef.current.set(cacheKey, entry);
        return entry;
      });

      driveListInflightRef.current.set(inflightKey, promise);
      promise.catch(() => driveListInflightRef.current.delete(inflightKey));
      promise.finally(() => {
        setTimeout(() => driveListInflightRef.current.delete(inflightKey), 60_000);
      });
      return promise;
    },
    [
      view,
      driveSearch,
      mimeFilter,
      sharedDriveIdForApi,
      buildFilesListParams,
      sortKey,
      sortDir,
    ]
  );

  const prefetchDriveFolder = useCallback(
    (folderId: string) => {
      const pathDepth = pathStack.length + 1;
      const cacheKey = driveListCacheKey({
        parent: folderId,
        view,
        search: "",
        mimeFilter,
        pathDepth,
        sharedDriveId: sharedDriveIdForApi,
        sortKey,
        sortDir,
      });
      if (driveListCacheRef.current.has(cacheKey)) return;
      void fetchDriveListPage(folderId, pathDepth);
    },
    [view, mimeFilter, pathStack.length, sharedDriveIdForApi, fetchDriveListPage, sortKey, sortDir]
  );

  const prefetchVisibleFolders = useCallback(
    (files: DriveFileRow[]) => {
      const folders = files
        .filter((f) => f.mimeType === "application/vnd.google-apps.folder")
        .slice(0, 8);
      for (const folder of folders) prefetchDriveFolder(folder.id);
    },
    [prefetchDriveFolder]
  );

  const loadDriveFiles = useCallback(
    async (opts: { append: boolean; pageToken?: string; bust?: boolean }) => {
      const loadId = `${driveListContextKey}\0${opts.pageToken ?? ""}\0${opts.append ? "a" : "f"}`;
      if (!opts.append) {
        activeDriveListLoadRef.current = loadId;
        setDriveListError(null);
        if (opts.bust) driveListCacheRef.current.delete(driveListContextKey);
        const cached = !opts.bust ? driveListCacheRef.current.get(driveListContextKey) : undefined;
        if (cached) {
          setDriveFiles(cached.files);
          setDriveNextPageToken(cached.nextPageToken);
          setLoadingDrive(false);
          setRefreshingDrive(true);
        } else {
          const hadList = driveFilesRef.current.length > 0;
          if (!hadList) {
            setDriveFiles([]);
            setLoadingDrive(true);
          } else {
            setRefreshingDrive(true);
          }
        }
      } else {
        setLoadingMore(true);
        loadingMoreRef.current = true;
      }
      try {
        const data = await fetchDriveListPage(
          currentParentId,
          pathStack.length,
          opts.pageToken,
          opts.bust
        );
        if (!opts.append && activeDriveListLoadRef.current !== loadId) return;
        setDriveFiles((prev) => {
          const next = opts.append
            ? [...prev, ...data.files]
            : (() => {
                // In search mode always replace — merging browse-mode files
                // into search results would show irrelevant local entries.
                if (driveSearch) return data.files;
                // In browse mode, keep any locally-added files (e.g. fresh
                // uploads) that the server hasn't indexed yet.
                const serverIds = new Set(data.files.map((f) => f.id));
                const localOnly = prev.filter((f) => !serverIds.has(f.id));
                return [...localOnly, ...data.files];
              })();
          driveListCacheRef.current.set(driveListContextKey, {
            files: next,
            nextPageToken: data.nextPageToken,
          });
          return next;
        });
        setDriveNextPageToken(data.nextPageToken);
        if (!opts.append) prefetchVisibleFolders(data.files);
      } catch (e) {
        if (!opts.append && activeDriveListLoadRef.current !== loadId) return;
        setDriveListError(e instanceof Error ? e.message : "Failed to load");
        if (!opts.append && driveFilesRef.current.length === 0) setDriveFiles([]);
      } finally {
        if (!opts.append && activeDriveListLoadRef.current === loadId) {
          setLoadingDrive(false);
          setRefreshingDrive(false);
        }
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [
      driveListContextKey,
      currentParentId,
      pathStack.length,
      driveSearch,
      fetchDriveListPage,
      prefetchVisibleFolders,
    ]
  );

  /** Drive API orderBy — list order matches Google Drive (no client re-sort). */
  const displayFiles = useMemo(
    () =>
      driveSearch || mimeFilter === "all" || mimeFilter === "folders"
        ? driveFiles
        : driveFiles.filter((f) => matchesMimeFilter(f, mimeFilter)),
    [driveFiles, mimeFilter, driveSearch]
  );

  /** Clear the visible list and cancel in-flight loads when changing folders. */
  function beginFolderNavigation() {
    activeDriveListLoadRef.current = `nav-${Date.now()}`;
    setDriveFiles([]);
    setLoadingDrive(true);
    setRefreshingDrive(false);
    setDriveNextPageToken(undefined);
    setDriveListError(null);
  }

  function enterFolder(id: string, name: string) {
    const alreadyHere =
      pathStack.length > 0 && pathStack[pathStack.length - 1].id === id;
    if (!alreadyHere) {
      setPathStack((prev) => [...prev, { id, name }]);
      beginFolderNavigation();
    } else {
      // Same folder id (double-click) — refresh contents instead of no-op.
      beginFolderNavigation();
      void loadDriveFiles({ append: false, bust: true });
    }
    // Match Google Drive: opening a folder exits search mode and shows
    // the folder's normal contents.
    setDriveSearchInput("");
    setDriveSearch("");
  }

  function navigateToDepth(endIndexExclusive: number) {
    if (endIndexExclusive === pathStack.length) return;
    setPathStack((prev) => prev.slice(0, endIndexExclusive));
    beginFolderNavigation();
    setDriveSearchInput("");
    setDriveSearch("");
  }

  useEffect(() => {
    void loadDriveFiles({ append: false });
  }, [loadDriveFiles]);

  // Auto-load more: observe the sentinel <li> inside the scrollable list.
  // Re-subscribes whenever driveNextPageToken changes so the new token is captured.
  useEffect(() => {
    const sentinel = loadMoreSentinelRef.current;
    const scroller = listScrollRef.current;
    if (!sentinel || !scroller || !driveNextPageToken) return;
    let fired = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !fired && !loadingMoreRef.current) {
          fired = true;
          observer.disconnect();
          void loadDriveFiles({ append: true, pageToken: driveNextPageToken });
        }
      },
      { root: scroller, rootMargin: "200px", threshold: 0 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [driveNextPageToken, loadDriveFiles]);

  const triggerFileUpload = useCallback(() => {
    setUploadMenuOpen(false);
    fileInputRef.current?.click();
  }, []);

  const triggerFolderUpload = useCallback(() => {
    setUploadMenuOpen(false);
    folderInputRef.current?.click();
  }, []);

  /** Upload a single File blob to {parentId}. Returns the created Drive
   *  file, or throws with a useful message. Shared by both the multi-file
   *  and folder-upload paths so error handling stays consistent. */
  async function uploadSingleFile(
    file: File,
    parentId: string,
    onProgress?: (percent: number) => void
  ): Promise<DriveFileRow> {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || "";
    const basename = (rel ? rel.split("/").pop() : file.name) || file.name || "upload";

    if (file.size > DRIVE_SIMPLE_UPLOAD_MAX_BYTES) {
      const uploaded = await uploadFileToDriveFolder(
        new File([file], basename, { type: file.type }),
        parentId,
        onProgress
      );
      return driveUploadResultToRow(uploaded);
    }

    const fd = new FormData();
    fd.set("file", file, basename);
    fd.set("parent", parentId);
    onProgress?.(50);
    const res = await fetch("/api/drive/upload", { method: "POST", body: fd });
    const raw = await res.text();
    let data: { error?: string; file?: DriveFileRow } = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      throw new Error(`Upload failed (${res.status}). Please try again.`);
    }
    if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
    if (!data.file) throw new Error("Upload returned no file metadata");
    onProgress?.(100);
    return data.file;
  }

  /** Create a Drive folder named `name` under `parentId` and return its id.
   *  Used by the folder-upload flow to replicate the source directory tree. */
  async function createFolderUnder(name: string, parentId: string): Promise<string> {
    const res = await fetch("/api/drive/folders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId }),
    });
    const j = (await res.json()) as { file?: { id?: string }; error?: string };
    if (!res.ok) throw new Error(j.error || "Failed to create folder");
    if (!j.file?.id) throw new Error("Folder creation returned no id");
    return j.file.id;
  }

  /** Multi-file upload. Each file goes to the current folder; we upload
   *  sequentially to avoid hitting Drive's per-user concurrency limits
   *  and keep error reporting linear. */
  async function onUploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);
    // Seed one queue row per file (status "queued"), then upload sequentially,
    // flipping each row to uploading → done/error as we go.
    const items: UploadQueueItem[] = list.map((file, i) => ({
      id: `f-${Date.now()}-${i}`,
      name: file.name,
      kind: "file",
      status: "queued",
    }));
    setUploadQueue(items);
    setUploadBusy(true);
    try {
      for (let i = 0; i < list.length; i++) {
        const item = items[i];
        updateQueueItem(item.id, { status: "uploading", percent: 0 });
        try {
          const uploaded = await uploadSingleFile(list[i], currentParentId, (pct) => {
            updateQueueItem(item.id, { percent: pct });
          });
          updateQueueItem(item.id, { status: "done", percent: 100 });
          syncDriveListCache((prev) => {
            if (prev.some((r) => r.id === uploaded.id)) return prev;
            return [uploaded, ...prev];
          });
        } catch (e) {
          updateQueueItem(item.id, {
            status: "error",
            error: e instanceof Error ? e.message : "Upload failed",
          });
        }
      }
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  /** Folder upload. Browsers expose the picked directory tree as a flat
   *  FileList where each File has a webkitRelativePath like
   *  "MyFolder/sub/file.txt". We:
   *    1. Walk all unique directory prefixes in path order (parents first).
   *    2. Create each on Drive once, caching the mapping
   *       prefix -> driveFolderId so deeper subfolders find their parent.
   *    3. Upload each file into the cached parent folder id.
   *  Sequential to keep error reporting linear and avoid Drive rate limits. */
  async function onUploadFolder(files: FileList | null) {
    if (!files?.length) return;
    const list = Array.from(files);

    // Collect unique parent-directory paths from each file's
    // webkitRelativePath. "" is the top level (current folder) and
    // already maps to currentParentId.
    const allDirPaths = new Set<string>();
    for (const f of list) {
      const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
      const parts = rel.split("/").slice(0, -1); // drop the file's own name
      for (let i = 1; i <= parts.length; i++) {
        allDirPaths.add(parts.slice(0, i).join("/"));
      }
    }
    // Sort by depth so parents are created before their children.
    const sortedDirs = Array.from(allDirPaths).sort(
      (a, b) => a.split("/").length - b.split("/").length
    );

    // Only show one queue row per top-level folder — Google Drive does not list
    // individual files inside a folder upload. The header shows "Uploading folder".
    const rootFolderNames = Array.from(
      new Set(
        list.map((f) => {
          const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
          return rel.split("/")[0] || f.name;
        })
      )
    );
    const rootFolderItems: UploadQueueItem[] = rootFolderNames.map((name, i) => ({
      id: `d-${Date.now()}-${i}`,
      name,
      kind: "folder",
      status: "queued",
    }));
    setUploadQueue(rootFolderItems);
    setUploadBusy(true);

    // Mark all root-folder rows as "uploading" immediately (they upload in parallel
    // with their contents; we flip to done once all their files are done).
    for (const item of rootFolderItems) {
      updateQueueItem(item.id, { status: "uploading" });
    }

    try {
      const folderIdByPath = new Map<string, string>();
      folderIdByPath.set("", currentParentId);

      const topLevelFolderRows: DriveFileRow[] = [];

      // Create folders in depth order, mapping each path → new Drive id.
      for (let i = 0; i < sortedDirs.length; i++) {
        const dirPath = sortedDirs[i];
        const parts = dirPath.split("/");
        const parentDirPath = parts.slice(0, -1).join("/");
        const parentId = folderIdByPath.get(parentDirPath) ?? currentParentId;
        const name = parts[parts.length - 1];
        try {
          const newId = await createFolderUnder(name, parentId);
          folderIdByPath.set(dirPath, newId);
          if (parts.length === 1) {
            topLevelFolderRows.push({
              id: newId,
              name,
              mimeType: "application/vnd.google-apps.folder",
              modifiedTime: new Date().toISOString(),
            });
          }
        } catch {
          // Mark the root folder row as errored if the top-level folder fails.
          if (parts.length === 1) {
            const rootItem = rootFolderItems.find((it) => it.name === name);
            if (rootItem) updateQueueItem(rootItem.id, { status: "error", error: "Failed to create folder" });
          }
        }
      }

      // Upload each file into its computed parent folder.
      const fileErrors = new Map<string, boolean>(); // rootFolderName → had error
      for (let i = 0; i < list.length; i++) {
        const f = list[i];
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || "";
        const parts = rel.split("/");
        const rootName = parts[0] || f.name;
        const dirPath = parts.slice(0, -1).join("/");
        const parentId = folderIdByPath.get(dirPath) ?? currentParentId;
        try {
          await uploadSingleFile(f, parentId);
        } catch {
          fileErrors.set(rootName, true);
        }
      }

      // Flip each root-folder row to done/error based on whether its files had errors.
      for (const item of rootFolderItems) {
        if (item.status !== "error") {
          updateQueueItem(item.id, {
            status: fileErrors.get(item.name) ? "error" : "done",
            error: fileErrors.get(item.name) ? "Some files failed to upload" : undefined,
          });
        }
      }

      // Prepend top-level folder(s) so they appear without reloading the whole list.
      if (topLevelFolderRows.length > 0) {
        syncDriveListCache((prev) => {
          const ids = new Set(topLevelFolderRows.map((f) => f.id));
          return [...topLevelFolderRows, ...prev.filter((f) => !ids.has(f.id))];
        });
      }
    } finally {
      setUploadBusy(false);
      if (folderInputRef.current) folderInputRef.current.value = "";
    }
  }

  /* ── Rename / Move / New-folder handlers ──────────────────── */

  /** Begin renaming a row — replaces its label with an input. */
  function startRename(file: DriveFileRow) {
    setRenameTargetId(file.id);
    setRenameValue(file.name);
    setMenuOpenId(null);
  }

  /** Commit an inline rename. Skip the PATCH if name didn't change or is empty. */
  async function commitRename(file: DriveFileRow) {
    const next = renameValue.trim();
    if (!next || next === file.name) {
      setRenameTargetId(null);
      return;
    }
    try {
      const res = await fetch(`/api/drive/file/${encodeURIComponent(file.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      const j = (await res.json()) as { file?: DriveFileRow; error?: string };
      if (!res.ok) throw new Error(j.error || "Rename failed");
      syncDriveListCache((rows) =>
        rows.map((r) => (r.id === file.id ? { ...r, name: next } : r))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setRenameTargetId(null);
    }
  }

  async function toggleStar(file: DriveFileRow) {
    const next = !file.starred;
    setMenuOpenId(null);
    setContextMenu(null);
    try {
      const res = await fetch(`/api/drive/file/${encodeURIComponent(file.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ starred: next }),
      });
      const j = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Could not update star");
      syncDriveListCache((rows) => {
        if (view === "starred" && !next) {
          return rows.filter((r) => r.id !== file.id);
        }
        return rows.map((r) => (r.id === file.id ? { ...r, starred: next } : r));
      });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not update star");
    }
  }

  async function copyItem(file: DriveFileRow) {
    setMenuOpenId(null);
    setContextMenu(null);
    try {
      const res = await fetch(`/api/drive/file/${encodeURIComponent(file.id)}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: currentParentId }),
      });
      const j = (await res.json()) as { file?: DriveFileRow; error?: string };
      if (!res.ok) throw new Error(j.error || "Copy failed");
      if (j.file) {
        syncDriveListCache((prev) => {
          if (prev.some((r) => r.id === j.file!.id)) return prev;
          return [j.file!, ...prev];
        });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Copy failed");
    }
  }

  function openRowContextMenu(e: ReactMouseEvent, file: DriveFileRow) {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpenId(null);
    setContextMenu({ x: e.clientX, y: e.clientY, file });
  }

  async function handleDroppedFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
    if (!files.length) return;
    const hasDir = files.some(
      (f) => (f as File & { webkitRelativePath?: string }).webkitRelativePath
    );
    if (hasDir) {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      await onUploadFolder(dt.files);
    } else {
      const dt = new DataTransfer();
      for (const f of files) dt.items.add(f);
      await onUploadFiles(dt.files);
    }
  }

  /** Issue a Drive move PATCH and refresh the list. */
  async function performMove(file: DriveFileRow, newParentId: string) {
    const res = await fetch(`/api/drive/file/${encodeURIComponent(file.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ parentId: newParentId }),
    });
    const j = (await res.json()) as { error?: string };
    if (!res.ok) throw new Error(j.error || "Move failed");
    syncDriveListCache((rows) => rows.filter((r) => r.id !== file.id));
  }

  /** Download a file or folder, showing a spinner while the server streams
   *  the response. Uses fetch → blob URL so we hold the "downloading" state
   *  for the full duration — unlike a bare anchor click which fires and
   *  forgets immediately with no visual feedback. */
  async function downloadItem(file: DriveFileRow) {
    if (downloadingIds.has(file.id)) return; // already in flight
    const isFolder = file.mimeType === "application/vnd.google-apps.folder";
    const url = isFolder
      ? `/api/drive/folder/${encodeURIComponent(file.id)}/download`
      : `/api/drive/file/${encodeURIComponent(file.id)}?mode=download`;

    setDownloadingIds((s) => new Set(s).add(file.id));
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const msg = await res.json().then((j: { error?: string }) => j.error).catch(() => null);
        alert(msg || `Download failed (${res.status})`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      // Extract filename from Content-Disposition header if present.
      const match = /filename\*?=(?:UTF-8'')?["']?([^"';\r\n]+)/i.exec(disposition);
      const filename = match
        ? decodeURIComponent(match[1].trim())
        : isFolder ? `${file.name}.zip` : file.name;
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch {
      alert("Download failed. Please try again.");
    } finally {
      setDownloadingIds((s) => { const n = new Set(s); n.delete(file.id); return n; });
    }
  }

  /** Create a new folder under the current location and refresh. */
  async function createFolder() {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const res = await fetch("/api/drive/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, parentId: currentParentId }),
      });
      const j = (await res.json()) as { file?: DriveFileRow; error?: string };
      if (!res.ok) throw new Error(j.error || "Failed to create folder");
      setNewFolderOpen(false);
      setNewFolderName("");
      if (j.file) {
        syncDriveListCache((prev) => {
          if (prev.some((r) => r.id === j.file!.id)) return prev;
          return [j.file!, ...prev];
        });
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  }

  useEffect(() => {
    if (!contextMenu) return;
    function onDoc() {
      setContextMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu]);

  /** Close the kebab menu on outside-click / Escape. */
  useEffect(() => {
    if (!menuOpenId) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target && !target.closest("[data-row-menu]")) setMenuOpenId(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpenId(null);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpenId]);

  /** Close the Upload dropdown on outside-click / Escape (same pattern). */
  useEffect(() => {
    if (!uploadMenuOpen) return;
    function onDoc(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target && !target.closest("[data-upload-menu]")) setUploadMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setUploadMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [uploadMenuOpen]);

  // Root label for the breadcrumb's first crumb — reflects which sidebar
  // view we're in.
  const canUploadHere =
    view !== "recent" &&
    (view === "my-drive" || view === "shared-drive" || pathStack.length > 0);

  const viewRootLabel =
    view === "my-drive"
      ? titleCase("My Drive")
      : view === "shared-with-me"
        ? "Shared with me"
        : view === "starred"
          ? "Starred"
          : view === "recent"
            ? "Recent"
            : currentSharedDrive?.name || "Shared drive";

  function fmtBytes(bytes: number): string {
    if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
    if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
    if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
    if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
    return `${bytes} B`;
  }

  const storageBar = (() => {
    if (!storageQuota) return null;
    const used = parseInt(storageQuota.usage ?? "0", 10);
    const limit = parseInt(storageQuota.limit ?? "0", 10);
    if (!limit) return null;
    const pct = Math.min(100, Math.round((used / limit) * 100));
    const isHigh = pct >= 90;
    const isMedium = pct >= 75;
    const barColor = isHigh ? "bg-red-500" : isMedium ? "bg-yellow-400" : "bg-[var(--color-primary)]";
    return (
      <div className="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg)] px-3 py-3">
        <div className="mb-1.5 flex items-center justify-between gap-1">
          <span className={cn("text-[12px] font-semibold", isHigh ? "text-red-500" : "text-[var(--color-text)]")}>
            {fmtBytes(used)}
            <span className="font-normal text-[var(--color-text-muted)]"> / {fmtBytes(limit)}</span>
          </span>
          <span className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] font-semibold",
            isHigh ? "bg-red-100 text-red-600" : isMedium ? "bg-yellow-100 text-yellow-700" : "bg-[var(--color-primary-tint)] text-[var(--color-primary)]"
          )}>
            {pct}%
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--color-border)]">
          <div
            className={cn("h-full rounded-full transition-all duration-500", barColor)}
            style={{ width: `${pct}%` }}
          />
        </div>
        {isHigh && (
          <p className="mt-1.5 text-[11px] font-medium text-red-500">Storage nearly full</p>
        )}
      </div>
    );
  })();

  const sidebarNav = (
    <>
        <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
          Drive
        </p>
        <SidebarItem
          icon={<HardDrive className="h-4 w-4" />}
          label="My Drive"
          active={view === "my-drive"}
          onClick={() => { switchView("my-drive"); setMobileNavOpen(false); }}
        />
        <SidebarItem
          icon={<Clock className="h-4 w-4" />}
          label="Recent"
          active={view === "recent"}
          onClick={() => { switchView("recent"); setMobileNavOpen(false); }}
        />
        <SidebarItem
          icon={<Users className="h-4 w-4" />}
          label="Shared with me"
          active={view === "shared-with-me"}
          onClick={() => { switchView("shared-with-me"); setMobileNavOpen(false); }}
        />
        <SidebarItem
          icon={<Star className="h-4 w-4" />}
          label="Starred"
          active={view === "starred"}
          onClick={() => { switchView("starred"); setMobileNavOpen(false); }}
        />

        {sharedDrives.length > 0 && (
          <>
            <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
              Shared drives
            </p>
            {sharedDrives.map((d) => (
              <SidebarItem
                key={d.id}
                icon={<HardDrive className="h-4 w-4" />}
                label={d.name}
                active={view === "shared-drive" && currentSharedDrive?.id === d.id}
                onClick={() => { switchSharedDrive(d); setMobileNavOpen(false); }}
              />
            ))}
          </>
        )}
    </>
  );

  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100dvh-56px-24px)] min-h-0 overflow-hidden md:-mx-6 md:-mt-6 md:h-[calc(100dvh-48px)]">
      {mobileNavOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 sm:hidden"
          aria-label="Close navigation"
          onClick={() => setMobileNavOpen(false)}
        />
      )}
      <aside
        className={cn(
          "z-50 flex w-[208px] shrink-0 flex-col border-r border-[var(--color-border)] bg-[var(--color-surface)]",
          "fixed inset-y-0 left-0 shadow-xl transition-transform sm:static sm:shadow-none",
          mobileNavOpen ? "translate-x-0" : "-translate-x-full sm:translate-x-0"
        )}
      >
        <div className="flex flex-1 flex-col gap-1 overflow-y-auto p-2">
          {sidebarNav}
        </div>
        {storageBar}
      </aside>

      <div
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--color-surface)]",
          isDragOver && "ring-2 ring-inset ring-[var(--color-primary)]"
        )}
        onDragEnter={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) setIsDragOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setIsDragOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          if (e.dataTransfer.files?.length) void handleDroppedFiles(e.dataTransfer.files);
        }}
      >
        {isDragOver && (
          <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[var(--color-primary)]/10">
            <p className="rounded-xl bg-[var(--color-surface)] px-4 py-2 text-sm font-medium shadow-[var(--shadow-lg)]">
              {titleCase("Drop files to upload")}
            </p>
          </div>
        )}
        {/* Slim progress bar at top — visible only while loading more pages */}
        <div
          className={cn(
            "absolute inset-x-0 top-0 z-10 h-[2px] origin-left bg-[var(--color-primary)] transition-all duration-300",
            loadingMore ? "animate-progress-bar opacity-100" : "w-0 opacity-0"
          )}
          aria-hidden
        />
        {/* Breadcrumbs — hidden while a search is active because search is
            drive-wide, not folder-scoped (same UX as Google Drive). */}
        <div className="flex shrink-0 flex-col">
        {!driveSearch && (
          <nav
            className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-[var(--color-border)] px-3 py-2.5 text-[13px]"
            aria-label="Drive folder path"
          >
            <button
              type="button"
              onClick={() => navigateToDepth(0)}
              className="rounded-md px-2 py-1 font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-tint)]"
            >
              {viewRootLabel}
            </button>
            {pathStack.map((crumb, index) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <IconChevronRight className="h-3 w-3 shrink-0 text-[var(--color-text-faint)]" />
                <button
                  type="button"
                  onClick={() => navigateToDepth(index + 1)}
                  className={`max-w-[200px] truncate rounded-md px-2 py-1 hover:bg-[var(--color-surface-offset)] ${
                    index === pathStack.length - 1
                      ? "font-semibold text-[var(--color-text)]"
                      : "font-medium text-[var(--color-text-muted)]"
                  }`}
                >
                  {crumb.name}
                </button>
              </span>
            ))}
          </nav>
        )}

        {/* Search results banner — replaces breadcrumbs when searching */}
        {driveSearch && (
          <div
            className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] px-3 py-2.5 text-[13px]"
            aria-live="polite"
          >
            <span className="flex items-center gap-2 text-[var(--color-text-muted)]">
              <IconSearch className="h-3.5 w-3.5 shrink-0" />
              <span>
                {titleCase("Searching all of Drive for")}{" "}
                <span className="font-semibold text-[var(--color-text)]">
                  &ldquo;{driveSearch}&rdquo;
                </span>
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setDriveSearchInput("");
                setDriveSearch("");
              }}
              className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-primary)] hover:bg-[var(--color-primary-tint)]"
            >
              {titleCase("Clear search")}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="btn-ghost shrink-0 rounded-lg p-2 sm:hidden"
            aria-label={titleCase("Open navigation")}
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="relative shrink-0">
            <Filter className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
            <select
              value={mimeFilter}
              onChange={(e) => setMimeFilter(e.target.value as MimeFilter)}
              className="input-field appearance-none py-2 pl-8 pr-8 text-[13px]"
              aria-label={titleCase("Filter by type")}
            >
              <option value="all">All types</option>
              <option value="folders">Folders</option>
              <option value="documents">Documents</option>
              <option value="spreadsheets">Spreadsheets</option>
              <option value="images">Images</option>
              <option value="videos">Videos</option>
              <option value="pdfs">PDFs</option>
            </select>
          </div>
          <div className="min-w-0 flex-1 px-2 py-1">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-faint)]" />
              <input
                type="search"
                value={driveSearchInput}
                onChange={(e) => setDriveSearchInput(e.target.value)}
                placeholder={titleCase("Search Drive")}
                className="input-field w-full py-2 pl-9 pr-3 text-sm"
                autoComplete="off"
              />
            </div>
          </div>
          {/* Hidden inputs — one per upload mode. The folder input uses
              webkitdirectory which makes the OS picker show a folder
              chooser; the browser then expands it into a flat FileList
              with webkitRelativePath set on each entry. */}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => void onUploadFiles(e.target.files)}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            // webkitdirectory is non-standard but supported everywhere we
            // care about; React doesn't know about it so we set via attr.
            // eslint-disable-next-line @typescript-eslint/ban-ts-comment
            // @ts-expect-error — webkitdirectory is a non-standard attribute
            webkitdirectory=""
            directory=""
            onChange={(e) => void onUploadFolder(e.target.files)}
          />
          <button
            type="button"
            onClick={() => { setNewFolderOpen(true); setNewFolderName(""); }}
            disabled={!canUploadHere}
            className="btn-ghost shrink-0 gap-2 px-3 py-2 text-[13px] disabled:opacity-40"
            title="New folder"
          >
            <FolderPlus className="h-4 w-4 shrink-0" strokeWidth={2} />
            {titleCase("New folder")}
          </button>

          {/* Upload dropdown — File upload vs Folder upload, matching Drive */}
          <div className="relative" data-upload-menu>
            <button
              type="button"
              onClick={() => setUploadMenuOpen((v) => !v)}
              disabled={uploadBusy || !canUploadHere}
              className="btn-secondary shrink-0 gap-2 px-3 py-2 text-[13px] disabled:opacity-40"
              title={titleCase("Upload to this folder")}
              aria-haspopup="menu"
              aria-expanded={uploadMenuOpen}
            >
              <Upload className="h-4 w-4 shrink-0" strokeWidth={2} />
              {uploadBusy ? titleCase("Uploading…") : titleCase("Upload")}
              <ChevronDown className="h-3 w-3 shrink-0 opacity-70" strokeWidth={2.5} />
            </button>
            {uploadMenuOpen && (
              <div
                className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-md)]"
                role="menu"
              >
                <RowMenuItem
                  icon={<FileUp className="h-3.5 w-3.5" />}
                  label="File upload"
                  onClick={triggerFileUpload}
                />
                <RowMenuItem
                  icon={<FolderUp className="h-3.5 w-3.5" />}
                  label="Folder upload"
                  onClick={triggerFolderUpload}
                />
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setViewMode((m) => (m === "list" ? "grid" : "list"))}
            className="btn-ghost shrink-0 rounded-lg p-2"
            title={viewMode === "list" ? titleCase("Grid view") : titleCase("List view")}
            aria-label={viewMode === "list" ? "Switch to grid view" : "Switch to list view"}
          >
            {viewMode === "list" ? <LayoutGrid className="h-4 w-4" /> : <List className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => void loadDriveFiles({ append: false, bust: true })}
            className="btn-ghost shrink-0 rounded-lg p-2"
            title={titleCase("Refresh")}
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </button>
        </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {refreshingDrive && !loadingDrive ? (
          <div className="h-[2px] shrink-0 origin-left animate-progress-bar bg-[var(--color-primary)]" aria-hidden />
        ) : null}
        {loadingDrive ? (
          <div className="scrollbar-thin flex-1 space-y-2 overflow-y-auto p-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : driveListError ? (
          <div className="flex flex-1 items-start overflow-hidden p-6 text-sm text-[var(--color-danger)]" role="alert">
            {driveListError}
          </div>
        ) : displayFiles.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 overflow-hidden p-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[var(--color-surface-offset)]">
              {driveSearch ? (
                <IconSearch className="h-7 w-7 text-[var(--color-text-faint)]" />
              ) : (
                <IconFolder className="h-7 w-7 text-[var(--color-text-faint)]" />
              )}
            </div>
            <p className="text-center text-sm text-[var(--color-text-muted)]">
              {titleCase(
                driveSearch
                  ? "No items match your search"
                  : mimeFilter !== "all"
                    ? "No items match this filter"
                    : "This folder is empty"
              )}
            </p>
            {!driveSearch && mimeFilter === "all" && (
              <p className="flex items-center gap-1.5 text-center text-[12px] text-[var(--color-text-faint)]">
                <Upload className="h-3.5 w-3.5" strokeWidth={2} />
                {titleCase("Drop files here or use the Upload button")}
              </p>
            )}
          </div>
        ) : (
          <div className={cn("flex min-h-0 flex-1 overflow-hidden", refreshingDrive && "opacity-70")}>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {/* Column headers — frozen above the scrolling file list (list view only). */}
            {viewMode === "list" && (
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface-offset)]/50 px-4 py-2 text-[12px] font-medium text-[var(--color-text-muted)]">
              <SortHeader
                label="Name"
                active={sortKey === "name"}
                dir={sortDir}
                onClick={() => toggleSort("name")}
                className="min-w-0 flex-1"
              />
              {showLocationColumn && (
                <span className="w-[160px] shrink-0 text-[12px] font-medium text-[var(--color-text-muted)]">
                  {titleCase("Location")}
                </span>
              )}
              <SortHeader
                label="Date modified"
                active={sortKey === "modifiedTime"}
                dir={sortDir}
                onClick={() => toggleSort("modifiedTime")}
                className="hidden w-[140px] shrink-0 sm:flex"
              />
              <SortHeader
                label="File size"
                active={sortKey === "size"}
                dir={sortDir}
                onClick={() => toggleSort("size")}
                className="hidden w-[90px] shrink-0 sm:flex"
              />
              <span className="w-7 shrink-0" aria-hidden />
            </div>
            )}

            <ul
              ref={listScrollRef}
              className={cn(
                "scrollbar-thin min-h-0 flex-1 overflow-y-auto",
                viewMode === "list"
                  ? "divide-y divide-[var(--color-border)]"
                  : "grid grid-cols-2 content-start gap-3 p-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5"
              )}
            >
              {displayFiles.map((file) => {
                const isFolder = file.mimeType === "application/vnd.google-apps.folder";
                const sizeNum = file.size ? parseInt(file.size, 10) : NaN;
                const sizeLabel =
                  isFolder ? "—" : !Number.isNaN(sizeNum) ? formatBytes(sizeNum) : "—";
                const dateLabel = file.modifiedTime ? formatDate(file.modifiedTime) : "—";
                const isRenaming = renameTargetId === file.id;

                const rowMenuActions = (
                  <>
                        <RowMenuItem
                          icon={<Share2 className="h-3.5 w-3.5" />}
                          label="Share"
                          onClick={() => { setMenuOpenId(null); setShareTarget(file); }}
                        />
                        <RowMenuItem
                          icon={
                            <Star
                              className={cn(
                                "h-3.5 w-3.5",
                                file.starred && "fill-amber-500 text-amber-500"
                              )}
                            />
                          }
                          label={file.starred ? "Remove star" : "Add star"}
                          onClick={() => void toggleStar(file)}
                        />
                        <RowMenuItem
                          icon={<Pencil className="h-3.5 w-3.5" />}
                          label="Rename"
                          onClick={() => startRename(file)}
                        />
                        <RowMenuItem
                          icon={<Copy className="h-3.5 w-3.5" />}
                          label="Make a copy"
                          onClick={() => void copyItem(file)}
                        />
                        <RowMenuItem
                          icon={<FolderInput className="h-3.5 w-3.5" />}
                          label="Move"
                          onClick={() => { setMenuOpenId(null); setMoveTarget(file); }}
                        />
                        <RowMenuItem
                          icon={<Info className="h-3.5 w-3.5" />}
                          label="Details"
                          onClick={() => {
                            setMenuOpenId(null);
                            setDetailsFileId(file.id);
                          }}
                        />
                        <RowMenuItem
                          icon={downloadingIds.has(file.id)
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <IconDownload className="h-3.5 w-3.5" />}
                          label={downloadingIds.has(file.id)
                            ? "Downloading…"
                            : isFolder ? "Download (.zip)" : "Download"}
                          onClick={() => { setMenuOpenId(null); void downloadItem(file); }}
                        />
                  </>
                );

                const RowMenu = (
                  <div className="relative" data-row-menu>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpenId(menuOpenId === file.id ? null : file.id);
                      }}
                      className="shrink-0 rounded-md p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
                      title="More actions"
                      aria-label="More actions"
                      aria-haspopup="menu"
                      aria-expanded={menuOpenId === file.id}
                    >
                      <MoreVertical className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                    {menuOpenId === file.id && (
                      <div
                        className="absolute right-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-md)]"
                        role="menu"
                      >
                        {rowMenuActions}
                      </div>
                    )}
                  </div>
                );

                const NameOrEditor = isRenaming ? (
                  <input
                    autoFocus
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={() => void commitRename(file)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); void commitRename(file); }
                      else if (e.key === "Escape") { e.preventDefault(); setRenameTargetId(null); }
                    }}
                    onFocus={(e) => {
                      const v = e.currentTarget.value;
                      const dot = v.lastIndexOf(".");
                      if (!isFolder && dot > 0) e.currentTarget.setSelectionRange(0, dot);
                      else e.currentTarget.select();
                    }}
                    className="w-full rounded-md border border-[var(--color-primary)] bg-[var(--color-surface)] px-1.5 py-0.5 text-[13px] text-[var(--color-text)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]/20"
                  />
                ) : (
                  <span className="truncate text-[13px] text-[var(--color-text)]">
                    {file.name}
                  </span>
                );

                const rowOnClick = () => {
                  if (isRenaming) return;
                  if (isFolder) enterFolder(file.id, file.name);
                  else setPreviewFile(file);
                };

                if (viewMode === "grid") {
                  return (
                    <li
                      key={file.id}
                      className="group relative flex flex-col gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--color-primary)]/40 hover:shadow-[var(--shadow-md)] hover:bg-[var(--color-surface-offset)]/40"
                      onContextMenu={(e) => openRowContextMenu(e, file)}
                      onMouseEnter={isFolder ? () => prefetchDriveFolder(file.id) : undefined}
                      onMouseDown={isFolder ? () => prefetchDriveFolder(file.id) : undefined}
                    >
                      {/* Kebab — top-right corner */}
                      <div className="absolute right-1.5 top-1.5 z-10">{RowMenu}</div>

                      <button
                        type="button"
                        onClick={rowOnClick}
                        className="relative flex flex-col items-center gap-3 pt-2 text-center"
                      >
                        <DriveMimeIcon
                          mimeType={file.mimeType}
                          name={file.name}
                          thumbnailLink={file.thumbnailLink}
                          className="h-12 w-12"
                          iconClassName="h-6 w-6"
                        />
                        {file.starred && (
                          <Star className="absolute left-2 top-2 h-3.5 w-3.5 fill-amber-500 text-amber-500" />
                        )}
                        <span className="line-clamp-2 w-full break-words px-1 text-[13px] text-[var(--color-text)]">
                          {isRenaming ? NameOrEditor : file.name}
                        </span>
                      </button>
                      {showLocationColumn && file.location && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFileLocation(file.location!);
                          }}
                          className="max-w-full truncate px-1 text-center text-[11px] text-[var(--color-primary)] hover:underline"
                          title={titleCase("Open folder")}
                        >
                          {file.location.label}
                        </button>
                      )}
                      <span className="mt-auto truncate text-center text-[11px] text-[var(--color-text-faint)]">
                        {isFolder ? dateLabel : `${sizeLabel} · ${dateLabel}`}
                      </span>
                    </li>
                  );
                }

                return (
                  <li
                    key={file.id}
                    role="button"
                    tabIndex={0}
                    onClick={rowOnClick}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); rowOnClick(); } }}
                    className="group flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--color-surface-offset)]"
                    onContextMenu={(e) => openRowContextMenu(e, file)}
                    onMouseEnter={isFolder ? () => prefetchDriveFolder(file.id) : undefined}
                    onMouseDown={isFolder ? () => prefetchDriveFolder(file.id) : undefined}
                  >
                    {/* Name column */}
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <DriveMimeIcon
                        mimeType={file.mimeType}
                        name={file.name}
                        thumbnailLink={file.thumbnailLink}
                        className="h-8 w-8"
                        iconClassName="h-4 w-4"
                      />
                      <span className="min-w-0 flex-1 flex items-center gap-1.5">
                        {NameOrEditor}
                        {file.starred && (
                          <Star className="h-3 w-3 shrink-0 fill-amber-500 text-amber-500" />
                        )}
                      </span>
                    </div>

                    {showLocationColumn && (
                      <span className="w-[160px] shrink-0">
                        {file.location ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openFileLocation(file.location!);
                            }}
                            className="flex max-w-full items-center gap-1 truncate text-left text-[13px] text-[var(--color-primary)] hover:underline"
                            title={`Open folder: ${file.location.label}`}
                          >
                            <IconFolder className="h-3.5 w-3.5 shrink-0 text-[var(--color-gold)]" />
                            <span className="truncate">{file.location.label}</span>
                          </button>
                        ) : (
                          <span className="text-[13px] text-[var(--color-text-faint)]">—</span>
                        )}
                      </span>
                    )}

                    {/* Date modified */}
                    <span className="hidden w-[140px] shrink-0 text-[13px] text-[var(--color-text-muted)] sm:block">
                      {dateLabel}
                    </span>

                    {/* File size */}
                    <span className="hidden w-[90px] shrink-0 text-[13px] text-[var(--color-text-muted)] sm:block">
                      {sizeLabel}
                    </span>

                    {/* Actions — stop propagation so kebab doesn't trigger row click */}
                    <div className="w-7 shrink-0" onClick={(e) => e.stopPropagation()}>
                      {RowMenu}
                    </div>
                  </li>
                );
              })}

              {/* Skeleton placeholders while loading the next page. */}
              {loadingMore && [0, 1, 2, 3].map((i) =>
                viewMode === "grid" ? (
                  <li key={`skel-${i}`} className="flex flex-col items-center gap-3 rounded-xl border border-[var(--color-border)] p-3">
                    <Skeleton className="skeleton-shimmer h-12 w-12 rounded-lg" />
                    <Skeleton className="skeleton-shimmer h-3 w-[70%] rounded" />
                  </li>
                ) : (
                  <li key={`skel-${i}`} className="flex items-center gap-3 px-4 py-2">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Skeleton className="skeleton-shimmer h-6 w-6 shrink-0 rounded" />
                      <Skeleton className="skeleton-shimmer h-3.5 w-[55%] rounded" />
                    </div>
                    <Skeleton className="skeleton-shimmer hidden h-3 w-[100px] shrink-0 rounded sm:block" />
                    <Skeleton className="skeleton-shimmer hidden h-3 w-[60px] shrink-0 rounded sm:block" />
                    <Skeleton className="skeleton-shimmer h-4 w-4 shrink-0 rounded" />
                  </li>
                )
              )}

              {/* Sentinel: scrolls into view at bottom; IntersectionObserver fires load-more.
                  In grid mode it spans all columns so it stays at the very bottom. */}
              {driveNextPageToken && (
                <li
                  ref={loadMoreSentinelRef}
                  className={cn("h-4 list-none", viewMode === "grid" && "col-span-full")}
                  aria-hidden
                />
              )}
            </ul>
          </div>
          {detailsFileId ? (
            <DriveDetailsPanel
              fileId={detailsFileId}
              onClose={() => setDetailsFileId(null)}
            />
          ) : null}
          </div>
        )}
        </div>
      </div>

      {contextMenu ? (
        <div
          className="fixed z-[60] w-48 overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-lg)]"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          data-row-menu
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const file = contextMenu.file;
            const isFolder = file.mimeType === "application/vnd.google-apps.folder";
            return (
              <>
                <RowMenuItem
                  icon={<Share2 className="h-3.5 w-3.5" />}
                  label="Share"
                  onClick={() => { setContextMenu(null); setShareTarget(file); }}
                />
                <RowMenuItem
                  icon={
                    <Star
                      className={cn(
                        "h-3.5 w-3.5",
                        file.starred && "fill-amber-500 text-amber-500"
                      )}
                    />
                  }
                  label={file.starred ? "Remove star" : "Add star"}
                  onClick={() => void toggleStar(file)}
                />
                <RowMenuItem
                  icon={<Pencil className="h-3.5 w-3.5" />}
                  label="Rename"
                  onClick={() => { setContextMenu(null); startRename(file); }}
                />
                <RowMenuItem
                  icon={<Copy className="h-3.5 w-3.5" />}
                  label="Make a copy"
                  onClick={() => void copyItem(file)}
                />
                <RowMenuItem
                  icon={<FolderInput className="h-3.5 w-3.5" />}
                  label="Move"
                  onClick={() => { setContextMenu(null); setMoveTarget(file); }}
                />
                <RowMenuItem
                  icon={<Info className="h-3.5 w-3.5" />}
                  label="Details"
                  onClick={() => {
                    setContextMenu(null);
                    setDetailsFileId(file.id);
                  }}
                />
                <RowMenuItem
                  icon={<IconDownload className="h-3.5 w-3.5" />}
                  label={isFolder ? "Download (.zip)" : "Download"}
                  onClick={() => { setContextMenu(null); void downloadItem(file); }}
                />
              </>
            );
          })()}
        </div>
      ) : null}

      {previewFile ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewFile(null);
          }}
        >
          <div
            className="flex h-full w-full max-w-2xl flex-col bg-[var(--color-surface)] shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drive-preview-title"
          >
            <div className="flex items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 id="drive-preview-title" className="truncate text-base font-semibold text-[var(--color-text)]">
                  {previewFile.name}
                </h2>
                <p className="mt-0.5 truncate font-mono text-[11px] text-[var(--color-text-faint)]">{previewFile.mimeType}</p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewFile(null)}
                className="btn-ghost shrink-0 rounded-full p-2"
                aria-label={titleCase("Close")}
              >
                <IconX className="h-5 w-5" />
              </button>
            </div>

            <div className="relative min-h-0 flex-1 bg-[var(--color-bg)]">
              {supportsInAppPreview(previewFile.mimeType, previewFile.name) ? (
                <>
                  {previewLoading && (
                    <div
                      className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-[var(--color-bg)]"
                      aria-live="polite"
                    >
                      <Loader2 className="h-8 w-8 animate-spin text-[var(--color-primary)]" />
                      <p className="text-sm font-medium text-[var(--color-text-muted)]">
                        {titleCase("Opening file")}
                      </p>
                    </div>
                  )}
                  <iframe
                    key={previewFile.id}
                    title={titleCase("File preview")}
                    /* Office/OpenDocument formats (.xlsx, .pptx, .docx, etc.) can't
                       render as raw bytes in an iframe — use Google Drive's hosted
                       viewer which handles them natively. Everything else streams
                       through our same-origin proxy. */
                    src={
                      isOfficeMimeType(previewFile.mimeType)
                        ? `https://drive.google.com/file/d/${encodeURIComponent(previewFile.id)}/preview`
                        : `/api/drive/file/${encodeURIComponent(previewFile.id)}?mode=preview`
                    }
                    className="h-full min-h-[50vh] w-full border-0 bg-white"
                    allow="autoplay"
                    onLoad={() => setPreviewLoading(false)}
                  />
                </>
              ) : (
                <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-[var(--color-text-muted)]">
                  <p>{titleCase("No in-app preview for this file type.")}</p>
                  <p className="text-xs text-[var(--color-text-faint)]">{titleCase("You can still download it below.")}</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--color-border)] p-4">
              {isOfficeMimeType(previewFile.mimeType) && previewFile.webViewLink ? (
                <a
                  href={previewFile.webViewLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-secondary gap-2"
                  title={titleCase("Open in Google Drive (new tab)")}
                >
                  {titleCase("Open in Drive")}
                </a>
              ) : null}
              <button
                type="button"
                onClick={() => void downloadItem(previewFile)}
                disabled={downloadingIds.has(previewFile.id)}
                className="btn-primary gap-2 disabled:opacity-60"
              >
                {downloadingIds.has(previewFile.id)
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <IconDownload className="h-4 w-4" />}
                {downloadingIds.has(previewFile.id) ? titleCase("Downloading…") : titleCase("Download")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Share modal — opens when the user clicks the Share button on a row */}
      {shareTarget ? (
        <DriveShareModal
          fileId={shareTarget.id}
          fileName={shareTarget.name}
          isFolder={shareTarget.mimeType === "application/vnd.google-apps.folder"}
          onClose={() => setShareTarget(null)}
        />
      ) : null}

      {/* Move modal — folder picker tree */}
      {moveTarget ? (
        <DriveMoveModal
          fileId={moveTarget.id}
          fileName={moveTarget.name}
          currentParentId={currentParentId}
          onMove={(newParent) => performMove(moveTarget, newParent)}
          onClose={() => setMoveTarget(null)}
        />
      ) : null}

      {/* Download-in-progress toast — bottom-right, styled like Google Drive's
          own "Preparing download" bar. Sits above the upload queue when open. */}
      {downloadingIds.size > 0 && (
        <div className={`fixed right-4 z-50 flex w-72 items-center gap-3 rounded-lg bg-[#1A1612] px-5 py-4 shadow-2xl dark:bg-[#2C2836] transition-all ${uploadQueue.length > 0 ? "bottom-[352px]" : "bottom-6"}`}>
          <Loader2 className="h-5 w-5 animate-spin text-white shrink-0" />
          <div className="flex flex-col min-w-0">
            <span className="text-[14px] font-medium text-white leading-tight">
              {downloadingIds.size === 1 ? "Preparing download…" : `Preparing ${downloadingIds.size} downloads…`}
            </span>
            <span className="text-[12px] text-white/60 leading-tight mt-0.5">This may take a moment</span>
          </div>
        </div>
      )}

      {/* Drive-style upload status card (bottom-right). */}
      <DriveUploadQueue
        items={uploadQueue}
        busy={uploadBusy}
        onClose={() => setUploadQueue([])}
      />

      {/* New folder modal */}
      {newFolderOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
          onClick={() => !creatingFolder && setNewFolderOpen(false)}
        >
          <div
            className="card w-full max-w-sm overflow-hidden animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-[var(--color-border)] px-5 py-4">
              <h3 className="text-base font-semibold text-[var(--color-text)]">New folder</h3>
            </div>
            <div className="px-5 py-4">
              <input
                autoFocus
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); void createFolder(); }
                  if (e.key === "Escape" && !creatingFolder) setNewFolderOpen(false);
                }}
                placeholder="Untitled folder"
                className="input-field w-full text-[13px]"
              />
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
              <button
                type="button"
                onClick={() => setNewFolderOpen(false)}
                disabled={creatingFolder}
                className="btn-ghost"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void createFolder()}
                disabled={creatingFolder || !newFolderName.trim()}
                className="btn-primary disabled:opacity-50"
              >
                {creatingFolder ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Sortable column header for the Drive table. Clicking flips the sort
 * direction on the active column, or activates this column ascending if
 * it wasn't the active one. Shows the up/down arrow only on the active
 * column, matching Google Drive.
 */
function SortHeader({
  label,
  active,
  dir,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 rounded px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--color-surface-offset)]",
        active ? "font-semibold text-[var(--color-text)]" : "text-[var(--color-text-muted)]",
        className,
      )}
    >
      <span className="truncate">{label}</span>
      {active &&
        (dir === "asc" ? (
          <ArrowUp className="h-3 w-3 shrink-0" strokeWidth={2.5} />
        ) : (
          <ArrowDown className="h-3 w-3 shrink-0" strokeWidth={2.5} />
        ))}
    </button>
  );
}

/**
 * Single item in the per-row kebab menu — icon + label, stops click
 * propagation so the row itself doesn't get clicked underneath.
 */
function RowMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]"
      role="menuitem"
    >
      <span className="shrink-0 text-[var(--color-text-faint)]">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

/**
 * Sidebar nav row — icon + label + active state.  Matches Google Drive's
 * left rail: rounded pill, primary-tinted background when selected.
 */
function SidebarItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg py-[6px] pl-3 pr-3 text-left text-[13px] font-medium transition-colors",
        active
          ? "bg-[var(--color-primary-light)] text-[var(--color-primary)] border-l-2 border-[var(--color-primary)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
