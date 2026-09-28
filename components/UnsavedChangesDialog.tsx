"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";

type Props = {
  /** Disables both leave paths while the save is in flight. */
  saving: boolean;
  /** Save, then leave — only if the save succeeds. */
  onSave: () => void;
  /** Leave and throw the edits away. */
  onDiscard: () => void;
  /** Stay on the page. */
  onCancel: () => void;
};

/**
 * Guard for leaving the sequence editor with unsaved step edits.
 *
 * Three ways out rather than the browser's two: steps are the one part of the
 * editor that is not written as you go (the name and the settings tab both
 * patch on blur), so a stray click on "All sequences" is the one action here
 * that can silently lose work. Discard is spelled out as its own button
 * instead of hiding behind Cancel, so neither choice is the accidental one.
 */
export function UnsavedChangesDialog({ saving, onSave, onDiscard, onCancel }: Props) {
  // Escape is the expected way out of a dialog, and here the safe reading of
  // it is "I did not mean to leave" — never the discarding one.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !saving) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [saving, onCancel]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-labelledby="unsaved-changes-title"
        aria-describedby="unsaved-changes-body"
        className="card w-full max-w-[420px] px-5 py-4 shadow-[var(--shadow-lg)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2
          id="unsaved-changes-title"
          className="text-[15px] font-semibold text-[var(--color-text)]"
        >
          You have unsaved changes
        </h2>
        <p
          id="unsaved-changes-body"
          className="mt-1.5 text-[13px] leading-snug text-[var(--color-text-muted)]"
        >
          Your edits to these steps haven&apos;t been saved yet. Leaving now would discard them.
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={saving} className="btn-ghost">
            Keep editing
          </button>
          <button type="button" onClick={onDiscard} disabled={saving} className="btn-danger">
            Discard changes
          </button>
          <button
            type="button"
            autoFocus
            onClick={onSave}
            disabled={saving}
            className="btn-primary-copper inline-flex items-center gap-2"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {saving ? "Saving…" : "Save and leave"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
