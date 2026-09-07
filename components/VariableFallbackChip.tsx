"use client";

import { useEffect, useRef, useState } from "react";

type Props = {
  /** Merge key without braces, e.g. "job_title". */
  variableKey: string;
  /** Current fallback, or "" if none set. */
  value: string;
  onChange: (next: string) => void;
  /**
   * Palette. "gmail" matches the compose dialog's own hard-coded colours;
   * "app" uses the workspace tokens so the chip reads correctly in dark mode
   * (the sequence editor). Behaviour is identical either way.
   */
  theme?: "gmail" | "app";
  /** Replaces the default "used for every recipient…" line under the input. */
  hint?: string;
};

const THEMES = {
  gmail: {
    chipSet: "bg-[#e6f4ea] text-[#137333] hover:bg-[#ceead6]",
    chipUnset: "bg-[#fce8b2] text-[#976900] hover:bg-[#f9d878]",
    popover: "border-[#dadce0] bg-white shadow-[0_4px_16px_rgba(60,64,67,0.28)]",
    label: "text-[#5f6368]",
    input: "border-[#dadce0] text-[#202124] focus:border-[#0b57d0]",
    note: "text-[#5f6368]",
  },
  app: {
    chipSet:
      "bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400",
    chipUnset: "bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400",
    popover:
      "border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lg)]",
    label: "text-[var(--color-text-muted)]",
    input:
      "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] focus:border-[var(--color-copper)]",
    note: "text-[var(--color-text-faint)]",
  },
} as const;

const CLOSE_DELAY_MS = 180;

/**
 * A missing `{variable}` on the review screen, with a hover-in editor for the
 * value to substitute when a recipient has no data for it.
 *
 * Hover opens the popover and a short close delay keeps it alive while the
 * pointer crosses the gap into it; clicking pins it open so typing can't be
 * interrupted by the pointer drifting away.
 */
export function VariableFallbackChip({ variableKey, value, onChange, theme = "gmail", hint }: Props) {
  const t = THEMES[theme];
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [draft, setDraft] = useState(value);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Re-sync when the committed value changes elsewhere (recipient switch).
  useEffect(() => { setDraft(value); }, [value]);

  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current); }, []);

  useEffect(() => {
    if (!pinned) return;
    function onDoc(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        commit();
        setPinned(false);
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinned, draft]);

  function commit() {
    if (draft.trim() !== value.trim()) onChange(draft.trim());
  }

  function scheduleClose() {
    if (pinned) return;
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), CLOSE_DELAY_MS);
  }

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }

  const hasFallback = value.trim().length > 0;

  return (
    <span
      ref={wrapRef}
      className="relative inline-block"
      onMouseEnter={() => { cancelClose(); setOpen(true); }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        onClick={() => { setPinned(true); setOpen(true); }}
        className={`rounded px-1 py-px font-mono text-[11px] underline decoration-dotted underline-offset-2 ${
          hasFallback ? t.chipSet : t.chipUnset
        }`}
      >
        {`{${variableKey}}`}
        {hasFallback ? ` → ${value.trim()}` : ""}
      </button>

      {open && (
        <span
          className={`absolute left-0 top-full z-[1001] mt-1 block w-[240px] rounded-lg border p-2 ${t.popover}`}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <label className={`mb-1 block text-[10px] font-semibold uppercase tracking-wide ${t.label}`}>
            Fallback for {`{${variableKey}}`}
          </label>
          <input
            autoFocus={pinned}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commit();
                setPinned(false);
                setOpen(false);
              }
              if (e.key === "Escape") {
                e.preventDefault();
                setDraft(value);
                setPinned(false);
                setOpen(false);
              }
            }}
            onBlur={commit}
            placeholder="e.g. there"
            className={`w-full rounded border px-2 py-1 text-[12px] outline-none ${t.input}`}
          />
          <span className={`mt-1 block text-[10px] leading-snug ${t.note}`}>
            {hint ?? "Used for every recipient with no value for this field."}
          </span>
        </span>
      )}
    </span>
  );
}
