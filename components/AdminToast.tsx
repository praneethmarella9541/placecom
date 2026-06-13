"use client";

import { useEffect } from "react";
import { createPortal } from "react-dom";
import { IconX } from "@/components/Icons";
import { cn } from "@/lib/utils";

export type AdminToastState = {
  message: string;
  variant: "info" | "success" | "error";
} | null;

export function AdminToast({
  toast,
  onDismiss,
}: {
  toast: AdminToastState;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(onDismiss, 5000);
    return () => window.clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast || typeof document === "undefined") return null;

  return createPortal(
    <div
      className={cn(
        "fixed bottom-6 right-6 z-[1100] max-w-sm rounded-xl border px-4 py-3 text-[13px] shadow-[var(--shadow-lg)]",
        toast.variant === "error"
          ? "border-red-200 bg-red-50 text-red-800"
          : toast.variant === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-900"
            : "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)]",
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-2">
        <span className="flex-1 leading-snug">{toast.message}</span>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded p-0.5 opacity-60 transition-opacity hover:opacity-100"
          aria-label="Dismiss"
        >
          <IconX className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>,
    document.body,
  );
}

export function toastVariantForMessage(message: string): "success" | "error" | "info" {
  const m = message.toLowerCase();
  if (
    m.includes("created") ||
    m.includes("updated") ||
    m.includes("removed") ||
    m.includes("deleted") ||
    m.includes("group")
  ) {
    return "success";
  }
  if (m.includes("error") || m.includes("failed") || m.includes("could not") || m.includes("network")) {
    return "error";
  }
  return "info";
}
