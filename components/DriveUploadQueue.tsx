"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, X, CheckCircle2, AlertCircle, Loader2, Ban } from "lucide-react";
import { IconFile, IconFolder } from "@/components/Icons";

/** Status of a single item in the upload queue. */
export type UploadItemStatus = "queued" | "uploading" | "done" | "error" | "cancelled";

export type UploadQueueItem = {
  /** Stable id for React keys + status updates. */
  id: string;
  name: string;
  /** "folder" rows are the directories created during a folder upload. */
  kind: "file" | "folder";
  status: UploadItemStatus;
  /** 0–100 while status === "uploading". */
  percent?: number;
  /** Populated when status === "error". */
  error?: string;
};

type Props = {
  items: UploadQueueItem[];
  /** True while any item is still queued/uploading. */
  busy: boolean;
  /** Stop all in-flight and queued uploads. */
  onCancel?: () => void;
  /** Dismiss the card (only offered once the queue settles). */
  onClose: () => void;
};

/**
 * Google-Drive-style upload status card, pinned bottom-right. Shows an
 * aggregate header ("Uploading N items" / "N uploads complete") that
 * collapses the per-item list, and one row per file/folder with a live
 * status icon (spinner → check, or error). Mirrors Drive's upload toast.
 */
export function DriveUploadQueue({ items, busy, onCancel, onClose }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  if (items.length === 0) return null;

  const total = items.length;
  const done = items.filter((i) => i.status === "done").length;
  const failed = items.filter((i) => i.status === "error").length;
  const cancelled = items.filter((i) => i.status === "cancelled").length;
  const inFlight = items.find((i) => i.status === "uploading");
  const allFolders = items.every((i) => i.kind === "folder");

  // Header text mirrors Drive: live count while uploading, summary when done.
  let heading: string;
  if (busy) {
    if (allFolders && total === 1) {
      heading = `Uploading "${items[0].name}"…`;
    } else if (allFolders) {
      heading = `Uploading ${total} folder${total > 1 ? "s" : ""}…`;
    } else {
      const settled = done + failed + cancelled;
      heading = `Uploading ${Math.min(settled + 1, total)} of ${total}…`;
    }
  } else if (failed > 0 || cancelled > 0) {
    const parts: string[] = [];
    if (done > 0) parts.push(`${done} done`);
    if (cancelled > 0) parts.push(`${cancelled} cancelled`);
    if (failed > 0) parts.push(`${failed} failed`);
    heading = parts.join(", ");
  } else {
    heading = total === 1 ? "Upload complete" : `${total} uploads complete`;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex items-center justify-between gap-2 bg-zinc-800 px-3 py-2 text-white dark:bg-zinc-950">
        <span className="truncate text-[13px] font-medium">{heading}</span>
        <div className="flex shrink-0 items-center gap-1">
          {busy && onCancel ? (
            <button
              type="button"
              onClick={onCancel}
              className="rounded px-2 py-1 text-[11px] font-medium text-zinc-200 hover:bg-white/10 hover:text-white"
            >
              Cancel
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            className="rounded p-1 text-zinc-300 hover:bg-white/10 hover:text-white"
            aria-label={collapsed ? "Expand" : "Collapse"}
            title={collapsed ? "Expand" : "Collapse"}
          >
            {collapsed ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={busy && onCancel ? onCancel : onClose}
            className="rounded p-1 text-zinc-300 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            aria-label={busy ? "Cancel upload" : "Dismiss"}
            title={busy ? "Cancel upload" : "Dismiss"}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!collapsed && (
        <ul className="max-h-72 overflow-y-auto">
          {items.map((item) => (
            <li
              key={item.id}
              className="border-b border-zinc-100 px-3 py-2 last:border-b-0 dark:border-zinc-800"
            >
              <div className="flex items-center gap-2">
              <span className="shrink-0 text-zinc-400">
                {item.kind === "folder" ? (
                  <IconFolder className="h-4 w-4" />
                ) : (
                  <IconFile className="h-4 w-4" />
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] text-zinc-700 dark:text-zinc-200" title={item.name}>
                {item.name}
              </span>
              <span className="shrink-0 tabular-nums text-[11px] text-zinc-500">
                {item.status === "uploading" ? (
                  item.percent != null ? (
                    `${item.percent}%`
                  ) : (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600 dark:text-blue-400" />
                  )
                ) : item.status === "done" ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-500" />
                ) : item.status === "cancelled" ? (
                  <Ban className="h-4 w-4 text-zinc-400" />
                ) : item.status === "error" ? (
                  <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-500" />
                ) : (
                  <span className="block h-4 w-4 rounded-full border-2 border-zinc-200 dark:border-zinc-700" />
                )}
              </span>
              </div>
              {item.status === "uploading" && item.percent != null && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-[width] duration-200"
                    style={{ width: `${Math.min(100, item.percent)}%` }}
                  />
                </div>
              )}
              {item.status === "cancelled" ? (
                <p className="mt-1 text-[11px] text-zinc-400">Cancelled</p>
              ) : null}
              {item.status === "error" && item.error ? (
                <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{item.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {!collapsed && inFlight && (
        <div className="border-t border-zinc-100 px-3 py-1.5 text-[11px] text-zinc-400 dark:border-zinc-800">
          {inFlight.name}
        </div>
      )}
    </div>
  );
}
