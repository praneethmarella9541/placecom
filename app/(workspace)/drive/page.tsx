"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import { Skeleton } from "@/components/Skeleton";
import { titleCase } from "@/lib/title-case";
import {
  IconSearch,
  IconRefresh,
  IconFolder,
  IconFile,
  IconChevronRight,
  IconDownload,
  IconX,
} from "@/components/Icons";
import { supportsInAppPreview, isOfficeMimeType } from "@/lib/drive-file-proxy";
import { DriveShareModal } from "@/components/DriveShareModal";
import { DriveMoveModal } from "@/components/DriveMoveModal";
import { Share2, HardDrive, Users, Star, FolderPlus, MoreVertical, Pencil, FolderInput } from "lucide-react";

type DriveView = "my-drive" | "shared-with-me" | "starred";
type SharedDrive = { id: string; name: string };

type DriveFileRow = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
};

type PathCrumb = { id: string; name: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false); // stable for the IntersectionObserver
  const listScrollRef = useRef<HTMLUListElement>(null);
  const loadMoreSentinelRef = useRef<HTMLLIElement>(null);
  const [driveListError, setDriveListError] = useState<string | null>(null);
  const [driveSearchInput, setDriveSearchInput] = useState("");
  const [driveSearch, setDriveSearch] = useState("");

  const [previewFile, setPreviewFile] = useState<DriveFileRow | null>(null);
  // Target file/folder for the share modal — null means modal closed.
  const [shareTarget, setShareTarget] = useState<DriveFileRow | null>(null);
  // Target file/folder for the move modal.
  const [moveTarget, setMoveTarget] = useState<DriveFileRow | null>(null);
  // Inline-rename target id + the value being typed.
  const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // Row-action menu (kebab) open state — keyed by file id.
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  // "New folder" modal state.
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creatingFolder, setCreatingFolder] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDriveSearch(driveSearchInput.trim()), 400);
    return () => clearTimeout(t);
  }, [driveSearchInput]);

  // Load the user's shared drives once on mount so the sidebar can list
  // them. Non-fatal on error (some accounts simply have none).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/drive/drives")
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
    setDriveSearchInput("");
    setDriveSearch("");
    setDriveNextPageToken(undefined);
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
    setDriveSearchInput("");
    setDriveSearch("");
    setDriveNextPageToken(undefined);
  }

  const loadDriveFiles = useCallback(
    async (opts: { append: boolean; pageToken?: string }) => {
      if (!opts.append) {
        setLoadingDrive(true);
        setDriveListError(null);
      } else {
        setLoadingMore(true);
        loadingMoreRef.current = true;
      }
      const params = new URLSearchParams({
        pageSize: "30",
        parent: currentParentId,
      });
      if (opts.pageToken) params.set("pageToken", opts.pageToken);
      if (driveSearch) params.set("search", driveSearch);
      // Only forward "view" when we're at the root of a special view and
      // not searching. After descending into a folder OR when searching,
      // the API uses parentId / global-search semantics regardless.
      if (
        !driveSearch &&
        pathStack.length === 0 &&
        (view === "shared-with-me" || view === "starred")
      ) {
        params.set("view", view);
      }
      try {
        const res = await fetch(`/api/drive/files?${params.toString()}`);
        // Parse defensively: a 5xx may return an HTML error page (not JSON),
        // and the raw "Unexpected token '<'" exception is useless to the user.
        // Read text first, then attempt JSON, so we always have a fallback.
        const raw = await res.text();
        let data: { error?: string; files?: DriveFileRow[]; nextPageToken?: string } = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          // Non-JSON response (HTML error page, auth redirect, etc.)
          throw new Error(
            res.status === 401 || res.status === 403
              ? "Sign-in needed for Drive. Please refresh or sign in again."
              : `Drive request failed (${res.status}). Please try again.`
          );
        }
        if (!res.ok) throw new Error(data.error || `Failed to load Drive (${res.status})`);
        setDriveFiles((prev) => (opts.append ? [...prev, ...(data.files || [])] : data.files || []));
        setDriveNextPageToken(data.nextPageToken);
      } catch (e) {
        setDriveListError(e instanceof Error ? e.message : "Failed to load");
        if (!opts.append) setDriveFiles([]);
      } finally {
        setLoadingDrive(false);
        setLoadingMore(false);
        loadingMoreRef.current = false;
      }
    },
    [driveSearch, currentParentId, view, pathStack.length]
  );

  function enterFolder(id: string, name: string) {
    setPathStack((prev) => [...prev, { id, name }]);
    setDriveNextPageToken(undefined);
    // Match Google Drive: opening a folder exits search mode and shows
    // the folder's normal contents.
    setDriveSearchInput("");
    setDriveSearch("");
  }

  function navigateToDepth(endIndexExclusive: number) {
    setPathStack((prev) => prev.slice(0, endIndexExclusive));
    setDriveNextPageToken(undefined);
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

  const triggerUpload = useCallback(() => {
    setUploadError(null);
    fileInputRef.current?.click();
  }, []);

  async function onUploadFiles(files: FileList | null) {
    if (!files?.length) return;
    const file = files[0];
    if (!file) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("parent", currentParentId);
      const res = await fetch("/api/drive/upload", {
        method: "POST",
        body: fd,
      });
      const raw = await res.text();
      let data: { error?: string; file?: DriveFileRow } = {};
      try {
        data = raw ? JSON.parse(raw) : {};
      } catch {
        throw new Error(`Upload failed (${res.status}). Please try again.`);
      }
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      await loadDriveFiles({ append: false });
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploadBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
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
      // Update the row in-place so the user sees the new name without a refetch
      setDriveFiles((rows) =>
        rows.map((r) => (r.id === file.id ? { ...r, name: next } : r))
      );
    } catch (e) {
      alert(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setRenameTargetId(null);
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
    // Removed from the current folder view — drop it from the list.
    setDriveFiles((rows) => rows.filter((r) => r.id !== file.id));
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
      await loadDriveFiles({ append: false });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to create folder");
    } finally {
      setCreatingFolder(false);
    }
  }

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

  // Root label for the breadcrumb's first crumb — reflects which sidebar
  // view we're in.
  const viewRootLabel =
    view === "my-drive"
      ? titleCase("My Drive")
      : view === "shared-with-me"
        ? "Shared with me"
        : view === "starred"
          ? "Starred"
          : currentSharedDrive?.name || "Shared drive";

  return (
    <div className="-mx-4 -mt-[calc(56px+16px)] flex h-[calc(100vh-56px)] overflow-hidden md:-mx-6 md:-mt-6 md:h-screen">
      {/* ── Sidebar ─────────────────────────────────────────────
          Mirrors Google Drive's left nav. Visible from sm+; on mobile
          we collapse it (Drive does the same — switches to a drawer). */}
      <aside className="hidden w-[208px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-[var(--color-border)] bg-[var(--color-bg)] p-2 sm:flex">
        <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
          Drive
        </p>
        <SidebarItem
          icon={<HardDrive className="h-4 w-4" />}
          label="My Drive"
          active={view === "my-drive"}
          onClick={() => switchView("my-drive")}
        />
        <SidebarItem
          icon={<Users className="h-4 w-4" />}
          label="Shared with me"
          active={view === "shared-with-me"}
          onClick={() => switchView("shared-with-me")}
        />
        <SidebarItem
          icon={<Star className="h-4 w-4" />}
          label="Starred"
          active={view === "starred"}
          onClick={() => switchView("starred")}
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
                onClick={() => switchSharedDrive(d)}
              />
            ))}
          </>
        )}
      </aside>

      <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--color-surface)]">
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
        {!driveSearch && (
          <nav
            className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-[var(--color-border)] px-3 py-2.5 text-[13px]"
            aria-label="Drive folder path"
          >
            <button
              type="button"
              onClick={() => navigateToDepth(0)}
              className="rounded-md px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              {viewRootLabel}
            </button>
            {pathStack.map((crumb, index) => (
              <span key={crumb.id} className="flex items-center gap-1">
                <IconChevronRight className="h-3 w-3 shrink-0 text-zinc-300 dark:text-zinc-600" />
                <button
                  type="button"
                  onClick={() => navigateToDepth(index + 1)}
                  className={`max-w-[200px] truncate rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
                    index === pathStack.length - 1
                      ? "font-semibold text-zinc-900 dark:text-zinc-100"
                      : "font-medium text-zinc-600 dark:text-zinc-400"
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
            <span className="flex items-center gap-2 text-zinc-600 dark:text-zinc-400">
              <IconSearch className="h-3.5 w-3.5 shrink-0" />
              <span>
                {titleCase("Searching all of Drive for")}{" "}
                <span className="font-semibold text-zinc-900 dark:text-zinc-100">
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
              className="rounded-md px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
            >
              {titleCase("Clear search")}
            </button>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-b border-[var(--color-border)] p-1.5">
          <div className="min-w-0 flex-1 px-2 py-1">
            <div className="relative">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
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
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => void onUploadFiles(e.target.files)}
          />
          <button
            type="button"
            onClick={() => { setNewFolderOpen(true); setNewFolderName(""); }}
            className="btn-ghost shrink-0 gap-2 px-3 py-2 text-[13px]"
            title="New folder"
          >
            <FolderPlus className="h-4 w-4 shrink-0" strokeWidth={2} />
            {titleCase("New folder")}
          </button>
          <button
            type="button"
            onClick={() => triggerUpload()}
            disabled={uploadBusy}
            className="btn-secondary shrink-0 gap-2 px-3 py-2 text-[13px]"
            title={titleCase("Upload file to this folder")}
          >
            <Upload className="h-4 w-4 shrink-0" strokeWidth={2} />
            {uploadBusy ? titleCase("Uploading…") : titleCase("Upload")}
          </button>
          <button
            type="button"
            onClick={() => void loadDriveFiles({ append: false })}
            className="btn-ghost shrink-0 rounded-lg p-2"
            title={titleCase("Refresh")}
          >
            <IconRefresh className="h-3.5 w-3.5" />
          </button>
        </div>

        {uploadError ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-700 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-300">
            {uploadError}
          </div>
        ) : null}

        {loadingDrive ? (
          <div className="space-y-2 p-4">
            {[...Array(8)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
        ) : driveListError ? (
          <div className="p-6 text-sm text-red-600 dark:text-red-400">{driveListError}</div>
        ) : driveFiles.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-10">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-zinc-100 dark:bg-zinc-800">
              <IconFolder className="h-7 w-7 text-zinc-400" />
            </div>
            <p className="text-center text-sm text-zinc-500">
              {titleCase(
                driveSearch ? "No items match your search" : "This folder is empty"
              )}
            </p>
          </div>
        ) : (
          <ul
            ref={listScrollRef}
            className="scrollbar-thin flex-1 divide-y divide-zinc-100 overflow-y-auto dark:divide-zinc-800/60"
          >
            {driveFiles.map((file) => {
              const isFolder = file.mimeType === "application/vnd.google-apps.folder";
              const sizeNum = file.size ? parseInt(file.size, 10) : NaN;
              const sizeLabel = !Number.isNaN(sizeNum) ? formatBytes(sizeNum) : null;
              const metaLine = [
                isFolder ? titleCase("Folder") : null,
                file.modifiedTime ? formatDate(file.modifiedTime) : null,
                !isFolder && sizeLabel ? sizeLabel : null,
              ]
                .filter(Boolean)
                .join(" · ");

              // Row layout: main clickable area (open/preview) + a kebab
              // menu (Share / Rename / Move). Hover-reveal at rest so the
              // row stays clean, matching Google Drive's appearance.
              const isRenaming = renameTargetId === file.id;
              const RowMenu = (
                <div className="relative" data-row-menu>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId(menuOpenId === file.id ? null : file.id);
                    }}
                    className={cn(
                      "shrink-0 rounded-md p-1.5 text-zinc-500 transition-opacity hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
                      menuOpenId === file.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    )}
                    title="More actions"
                    aria-label="More actions"
                    aria-haspopup="menu"
                    aria-expanded={menuOpenId === file.id}
                  >
                    <MoreVertical className="h-3.5 w-3.5" strokeWidth={2} />
                  </button>
                  {menuOpenId === file.id && (
                    <div
                      className="absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
                      role="menu"
                    >
                      <RowMenuItem
                        icon={<Share2 className="h-3.5 w-3.5" />}
                        label="Share"
                        onClick={() => { setMenuOpenId(null); setShareTarget(file); }}
                      />
                      <RowMenuItem
                        icon={<Pencil className="h-3.5 w-3.5" />}
                        label="Rename"
                        onClick={() => startRename(file)}
                      />
                      <RowMenuItem
                        icon={<FolderInput className="h-3.5 w-3.5" />}
                        label="Move"
                        onClick={() => { setMenuOpenId(null); setMoveTarget(file); }}
                      />
                    </div>
                  )}
                </div>
              );

              // While renaming, the label cell becomes an input field.
              // It autofocuses, selects all, and commits on blur / Enter
              // (Escape cancels).  Click events inside it don't propagate
              // so we don't accidentally enter the folder.
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
                    // Select just the basename for files (preserve extension).
                    const v = e.currentTarget.value;
                    const dot = v.lastIndexOf(".");
                    if (!isFolder && dot > 0) e.currentTarget.setSelectionRange(0, dot);
                    else e.currentTarget.select();
                  }}
                  className="w-full rounded border border-indigo-300 bg-white px-1.5 py-0.5 text-[13px] font-semibold text-zinc-900 outline-none focus:border-indigo-500 dark:border-indigo-700 dark:bg-zinc-900 dark:text-zinc-100"
                />
              ) : (
                <p className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
                  {file.name}
                </p>
              );

              if (isFolder) {
                return (
                  <li key={file.id} className="group flex items-stretch hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                    <button
                      type="button"
                      onClick={() => !isRenaming && enterFolder(file.id, file.name)}
                      className="flex flex-1 items-start gap-3 px-4 py-3 text-left transition-colors"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-100/80 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                        <IconFolder className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        {NameOrEditor}
                        <p className="mt-0.5 text-[11px] text-zinc-500">{metaLine}</p>
                      </div>
                    </button>
                    <div className="flex items-center gap-1 pr-3">
                      {RowMenu}
                      <IconChevronRight className="h-4 w-4 shrink-0 text-zinc-400 dark:text-zinc-500" />
                    </div>
                  </li>
                );
              }

              return (
                <li key={file.id} className="group flex items-stretch hover:bg-zinc-50 dark:hover:bg-zinc-900/50">
                  <button
                    type="button"
                    onClick={() => !isRenaming && setPreviewFile(file)}
                    className="flex flex-1 cursor-pointer items-start gap-3 px-4 py-3 text-left text-zinc-800 transition-colors dark:text-zinc-200"
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-200/60 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      <IconFile className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      {NameOrEditor}
                      <p className="mt-0.5 text-[11px] text-zinc-500">{metaLine}</p>
                    </div>
                  </button>
                  <div className="flex items-center gap-1 pr-3">
                    {RowMenu}
                    <IconChevronRight className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-600" />
                  </div>
                </li>
              );
            })}

            {/* Skeleton rows appended while loading the next page */}
            {loadingMore && [0, 1, 2, 3].map((i) => (
              <li key={`skel-${i}`} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="skeleton-shimmer h-9 w-9 shrink-0 rounded-lg" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="skeleton-shimmer h-3.5 w-[60%] rounded" />
                  <Skeleton className="skeleton-shimmer h-3 w-[30%] rounded" />
                </div>
                <Skeleton className="skeleton-shimmer h-4 w-4 shrink-0 rounded" />
              </li>
            ))}

            {/* Sentinel: scrolls into view at bottom; IntersectionObserver fires load-more */}
            {driveNextPageToken && (
              <li ref={loadMoreSentinelRef} className="h-4 list-none" aria-hidden />
            )}
          </ul>
        )}
      </div>

      {previewFile ? (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm"
          role="presentation"
          onClick={(e) => {
            if (e.target === e.currentTarget) setPreviewFile(null);
          }}
        >
          <div
            className="flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl dark:bg-zinc-950"
            role="dialog"
            aria-modal="true"
            aria-labelledby="drive-preview-title"
          >
            <div className="flex items-center justify-between gap-3 border-b border-zinc-200 px-4 py-3">
              <div className="min-w-0 flex-1">
                <h2 id="drive-preview-title" className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                  {previewFile.name}
                </h2>
                <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{previewFile.mimeType}</p>
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

            <div className="min-h-0 flex-1 bg-zinc-100 dark:bg-zinc-900/50">
              {supportsInAppPreview(previewFile.mimeType) ? (
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
                  className="h-full min-h-[50vh] w-full border-0"
                  allow="autoplay"
                />
              ) : (
                <div className="flex h-full min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center text-sm text-zinc-500">
                  <p>{titleCase("No in-app preview for this file type.")}</p>
                  <p className="text-xs">{titleCase("You can still download it below.")}</p>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2 border-t border-zinc-200 p-4">
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
              <a
                href={`/api/drive/file/${encodeURIComponent(previewFile.id)}?mode=download`}
                className="btn-primary gap-2"
              >
                <IconDownload className="h-4 w-4" />
                {titleCase("Download")}
              </a>
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
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-zinc-800"
      role="menuitem"
    >
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{icon}</span>
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
        "flex w-full items-center gap-3 rounded-r-full py-[6px] pl-4 pr-3 text-left text-[13px] font-medium transition-colors",
        active
          ? "bg-[var(--color-primary-light)] text-[var(--color-primary)]"
          : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}
