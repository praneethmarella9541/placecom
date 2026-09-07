"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  title: string;
  body: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" paints the confirm red and puts initial focus on Cancel. */
  tone?: "default" | "danger";
  /** Swaps the confirm label for a spinner and locks both buttons. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The app's own confirmation, in place of window.confirm.
 *
 * The native dialog can't be styled, renders the page's origin above the
 * question, and blocks the main thread — so it reads as a browser warning
 * rather than a decision about the user's own data. Same portal/backdrop
 * shape as MassSendingToggleDialog.
 */
export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  busy = false,
  onConfirm,
  onCancel,
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  if (typeof document === "undefined") return null;
  const danger = tone === "danger";

  return createPortal(
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div
        role="alertdialog"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-body"
        className="card w-full max-w-[420px] px-5 py-4 shadow-[var(--shadow-lg)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-dialog-title" className="text-[15px] font-semibold text-[var(--color-text)]">
          {title}
        </h2>
        <p
          id="confirm-dialog-body"
          className="mt-1.5 text-[13px] leading-snug text-[var(--color-text-muted)]"
        >
          {body}
        </p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {/* A destructive action opens with the safe option focused, so a
              stray Enter cancels rather than confirms. */}
          <button
            type="button"
            autoFocus={danger}
            onClick={onCancel}
            disabled={busy}
            className="btn-ghost"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            autoFocus={!danger}
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "inline-flex items-center gap-2",
              danger ? "btn-danger" : "btn-primary-copper",
            )}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
