"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { clearDriveListSessionCache } from "@/lib/drive-list-prefetch";
import { useAllowDelete } from "@/lib/use-allow-delete";

/**
 * Trash button for a Google file row (Doc, Sheet, Form). Renders nothing
 * unless /configs "Allow delete" is on; the API enforces the same switch.
 */
export function DeleteListItemButton({
  fileId,
  label,
  kind,
  onDeleted,
  onError,
}: {
  fileId: string;
  label: string;
  kind: "doc" | "sheet" | "form";
  onDeleted: () => void;
  onError: (message: string) => void;
}) {
  const allowDelete = useAllowDelete();
  const [busy, setBusy] = useState(false);
  if (!allowDelete) return null;

  async function run() {
    if (busy) return;
    if (!window.confirm(`Move ${kind} "${label}" to trash?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/files/${encodeURIComponent(fileId)}`, { method: "DELETE" });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error || "Delete failed");
      // Drive's cached lists (My Drive, Trash, …) predate this delete.
      clearDriveListSessionCache();
      onDeleted();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Delete failed");
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid={`delete-${kind}-${fileId}`}
      onClick={() => void run()}
      disabled={busy}
      title="Move to trash"
      aria-label={`Move ${kind} to trash`}
      className="shrink-0 rounded-md p-1.5 text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-danger)] disabled:opacity-45"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
    </button>
  );
}
