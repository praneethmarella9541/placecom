"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Info } from "lucide-react";

/** What each analytics number means — one line per card, shown from its info icon. */
export const METRIC_HELP = {
  sent: "Every email your team sent in this range: new emails, replies and sequence emails.",
  opened: "Emails sent in this range that the recipient opened.",
  responded: "Replies recipients sent back in this range.",
  bounced: "Addresses your emails in this range couldn't be delivered to.",
} as const;

/**
 * A small "i" beside a label. Hover, keyboard focus or a tap opens a short
 * explanation; moving away, Escape or tapping elsewhere closes it.
 */
export function InfoTip({ text, label }: { text: string; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={open ? id : undefined}
        onClick={() => setOpen((v) => !v)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--color-text-faint)] transition-colors hover:text-[var(--color-text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-copper)]"
      >
        <Info className="h-3.5 w-3.5" aria-hidden />
      </button>
      {open && (
        <span
          id={id}
          role="tooltip"
          className="absolute left-1/2 top-full z-30 mt-2 w-60 -translate-x-1/2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-left text-[12px] font-normal normal-case leading-snug tracking-normal text-[var(--color-text-muted)] shadow-lg"
        >
          {text}
        </span>
      )}
    </span>
  );
}
