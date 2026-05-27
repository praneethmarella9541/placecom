"use client";

import { useCallback, useEffect, useState } from "react";
import { IconChevronRight, IconFolder, IconX } from "@/components/Icons";

/**
 * Drive-style "Move to" modal.
 *
 * Shows a folder navigator: starts at My Drive root, lists subfolders only
 * (drive files are not valid destinations), supports descending into
 * subfolders with a breadcrumb to navigate back. The "Move here" button
 * uses the currently-displayed folder as the destination.
 *
 * The file being moved is excluded from the destination list so users
 * can't try to move a folder into itself.
 */

type FolderRow = {
  id: string;
  name: string;
  mimeType: string;
};

type Crumb = { id: string; name: string };

type Props = {
  fileId: string;
  fileName: string;
  /** Current parent of the file — passed so we can disable "Move here" at
   *  the same folder (Drive does the same — the button is grayed out). */
  currentParentId: string;
  onMove: (newParentId: string) => Promise<void>;
  onClose: () => void;
};

export function DriveMoveModal({ fileId, fileName, currentParentId, onMove, onClose }: Props) {
  // Path stack — empty = at My Drive root.
  const [pathStack, setPathStack] = useState<Crumb[]>([]);
  const folderId = pathStack.length === 0 ? "root" : pathStack[pathStack.length - 1].id;

  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);

  const load = useCallback(
    async (parent: string) => {
      setLoading(true);
      setError(null);
      try {
        // Reuse the existing files endpoint — we'll filter to folders client-
        // side. Drive's q-syntax could filter on mimeType but reusing the
        // endpoint keeps things simple and avoids a new API surface.
        const params = new URLSearchParams({ parent, pageSize: "50" });
        const res = await fetch(`/api/drive/files?${params.toString()}`);
        const j = (await res.json()) as {
          files?: FolderRow[];
          error?: string;
        };
        if (!res.ok) throw new Error(j.error || "Failed to load folders");
        const onlyFolders = (j.files ?? [])
          .filter((f) => f.mimeType === "application/vnd.google-apps.folder")
          .filter((f) => f.id !== fileId); // never list the file being moved
        setFolders(onlyFolders);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load folders");
      } finally {
        setLoading(false);
      }
    },
    [fileId]
  );

  useEffect(() => { void load(folderId); }, [folderId, load]);

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-md overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-5 py-4">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[var(--color-text)]">Move to</h3>
            <p className="mt-0.5 truncate text-[13px] text-[var(--color-text-muted)]">
              {fileName}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="btn-ghost p-1.5"
            aria-label="Close"
          >
            <IconX className="h-4 w-4" />
          </button>
        </div>

        {/* Breadcrumb */}
        <nav className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-[var(--color-border)] px-3 py-2 text-[12px]">
          <button
            type="button"
            onClick={() => goUp(0)}
            className="rounded-md px-2 py-1 font-medium text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
          >
            My Drive
          </button>
          {pathStack.map((crumb, index) => (
            <span key={crumb.id} className="flex items-center gap-1">
              <IconChevronRight className="h-3 w-3 shrink-0 text-zinc-300 dark:text-zinc-600" />
              <button
                type="button"
                onClick={() => goUp(index + 1)}
                className={`max-w-[160px] truncate rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800 ${
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

        {/* Folder list */}
        <div className="max-h-72 min-h-[160px] overflow-y-auto px-2 py-1">
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

        <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border)] px-5 py-3">
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
  );
}
