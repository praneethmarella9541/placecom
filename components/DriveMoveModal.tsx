"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HardDrive } from "lucide-react";
import { IconChevronRight, IconFolder, IconX } from "@/components/Icons";
import { cn } from "@/lib/utils";

type FolderRow = {
  id: string;
  name: string;
  mimeType: string;
};

type Crumb = { id: string; name: string };
type SharedDrive = { id: string; name: string };

type Props = {
  fileId: string;
  fileName: string;
  currentParentId: string;
  onMove: (newParentId: string) => Promise<void>;
  onClose: () => void;
};

/**
 * Drive-style "Move to" modal with My Drive + shared drives destinations.
 */
export function DriveMoveModal({ fileId, fileName, currentParentId, onMove, onClose }: Props) {
  const [sharedDrives, setSharedDrives] = useState<SharedDrive[]>([]);
  const [destination, setDestination] = useState<"my-drive" | "shared-drive">("my-drive");
  const [activeSharedDrive, setActiveSharedDrive] = useState<SharedDrive | null>(null);
  const [pathStack, setPathStack] = useState<Crumb[]>([]);

  const folderId =
    pathStack.length === 0
      ? destination === "shared-drive" && activeSharedDrive
        ? activeSharedDrive.id
        : "root"
      : pathStack[pathStack.length - 1].id;

  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const folderCacheRef = useRef<Map<string, FolderRow[]>>(new Map());
  const folderInflightRef = useRef<Map<string, Promise<FolderRow[]>>>(new Map());
  const activeFolderLoadRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/drive/drives", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { drives?: SharedDrive[] } | null) => {
        if (!cancelled && j?.drives) setSharedDrives(j.drives);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (parent: string) => {
      const loadId = `${destination}\0${activeSharedDrive?.id ?? ""}\0${parent}`;
      activeFolderLoadRef.current = loadId;
      setError(null);
      const cached = folderCacheRef.current.get(loadId);
      if (cached) {
        setFolders(cached);
        setLoading(false);
      } else {
        setFolders([]);
        setLoading(true);
      }
      let inflight = folderInflightRef.current.get(loadId);
      if (!inflight) {
        inflight = (async () => {
          const params = new URLSearchParams({
            parent,
            pageSize: "100",
            mimeType: "application/vnd.google-apps.folder",
          });
          if (destination === "shared-drive" && activeSharedDrive) {
            params.set("sharedDriveId", activeSharedDrive.id);
          }
          const res = await fetch(`/api/drive/files?${params.toString()}`);
          const j = (await res.json()) as {
            files?: FolderRow[];
            error?: string;
          };
          if (!res.ok) throw new Error(j.error || "Failed to load folders");
          return (j.files ?? []).filter((f) => f.id !== fileId);
        })();
        folderInflightRef.current.set(loadId, inflight);
        inflight.finally(() => {
          setTimeout(() => folderInflightRef.current.delete(loadId), 60_000);
        });
        inflight.catch(() => folderInflightRef.current.delete(loadId));
      }
      try {
        const rows = await inflight;
        folderCacheRef.current.set(loadId, rows);
        if (activeFolderLoadRef.current !== loadId) return;
        setFolders(rows);
      } catch (e) {
        if (activeFolderLoadRef.current !== loadId) return;
        setError(e instanceof Error ? e.message : "Failed to load folders");
        setFolders([]);
      } finally {
        if (activeFolderLoadRef.current === loadId) setLoading(false);
      }
    },
    [fileId, destination, activeSharedDrive]
  );

  useEffect(() => {
    void load(folderId);
  }, [folderId, load]);

  function selectMyDrive() {
    setDestination("my-drive");
    setActiveSharedDrive(null);
    setPathStack([]);
  }

  function selectSharedDrive(drive: SharedDrive) {
    setDestination("shared-drive");
    setActiveSharedDrive(drive);
    setPathStack([]);
  }

  function enter(folder: FolderRow) {
    setPathStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
  }

  function goUp(idx: number) {
    setPathStack((prev) => prev.slice(0, idx));
  }

  async function handleMoveHere() {
    if (folderId === currentParentId) return;
    setMoving(true);
    setError(null);
    try {
      await onMove(folderId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Move failed");
    } finally {
      setMoving(false);
    }
  }

  const rootLabel =
    destination === "shared-drive" && activeSharedDrive
      ? activeSharedDrive.name
      : "My Drive";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card flex w-full max-w-lg overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex min-h-[360px] w-full flex-col sm:flex-row">
          <div className="w-full shrink-0 border-b border-[var(--color-border)] p-2 sm:w-[168px] sm:border-b-0 sm:border-r">
            <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
              Locations
            </p>
            <button
              type="button"
              onClick={selectMyDrive}
              className={cn(
                "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
                destination === "my-drive"
                  ? "bg-[var(--color-primary-light)] font-medium text-[var(--color-primary)]"
                  : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
              )}
            >
              <HardDrive className="h-4 w-4 shrink-0" />
              <span className="truncate">My Drive</span>
            </button>
            {sharedDrives.length > 0 && (
              <>
                <p className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-widest text-[var(--color-text-faint)]">
                  Shared drives
                </p>
                <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                  {sharedDrives.map((d) => (
                    <li key={d.id}>
                      <button
                        type="button"
                        onClick={() => selectSharedDrive(d)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px]",
                          destination === "shared-drive" && activeSharedDrive?.id === d.id
                            ? "bg-[var(--color-primary-light)] font-medium text-[var(--color-primary)]"
                            : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
                        )}
                      >
                        <HardDrive className="h-4 w-4 shrink-0" />
                        <span className="truncate">{d.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
              <div className="min-w-0">
                <h3 className="text-base font-semibold text-[var(--color-text)]">Move to</h3>
                <p className="mt-0.5 truncate text-[13px] text-[var(--color-text-muted)]">
                  {fileName}
                </p>
              </div>
              <button type="button" onClick={onClose} className="btn-ghost p-1.5" aria-label="Close">
                <IconX className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-[var(--color-border)] px-3 py-2 text-[12px]">
              <button
                type="button"
                onClick={() => goUp(0)}
                className="rounded-md px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
              >
                {rootLabel}
              </button>
              {pathStack.map((crumb, index) => (
                <span key={crumb.id} className="flex items-center gap-1">
                  <IconChevronRight className="h-3 w-3 shrink-0 text-zinc-300 dark:text-zinc-600" />
                  <button
                    type="button"
                    onClick={() => goUp(index + 1)}
                    className={`max-w-[140px] truncate rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
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

            <div className="max-h-56 min-h-[140px] flex-1 overflow-y-auto px-2 py-1">
              {loading ? (
                <p className="px-3 py-4 text-[12px] text-[var(--color-text-muted)]">Loading…</p>
              ) : error ? (
                <p className="px-3 py-4 text-[12px] text-[var(--color-danger)]">{error}</p>
              ) : folders.length === 0 ? (
                <p className="px-3 py-4 text-[12px] text-[var(--color-text-muted)]">
                  No subfolders here.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {folders.map((f) => (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => enter(f)}
                        className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-offset)]"
                      >
                        <IconFolder className="h-4 w-4 shrink-0 text-amber-600" />
                        <span className="min-w-0 flex-1 truncate text-[var(--color-text)]">
                          {f.name}
                        </span>
                        <IconChevronRight className="h-4 w-4 shrink-0 text-zinc-300 dark:text-zinc-600" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-4 py-3">
              <button type="button" onClick={onClose} className="btn-ghost" disabled={moving}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleMoveHere()}
                disabled={moving || folderId === currentParentId}
                className="btn-primary disabled:opacity-50"
                title={folderId === currentParentId ? "Already in this folder" : undefined}
              >
                {moving ? "Moving…" : "Move here"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
