"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  /** 1-based position of the first and last row on this page. */
  start: number;
  end: number;
  /** The "of …" part: "1,234", "20,000+" or "many" while the count is still being worked out. */
  totalText: string;
  hasNewer: boolean;
  hasOlder: boolean;
  onNewer: () => void;
  onOlder: () => void;
  busy?: boolean;
  /** Arrows only — for a crowded toolbar (rows selected). */
  compact?: boolean;
};

/**
 * Gmail-style pager: "1–50 of 4,238" with Newer / Older arrows. Gmail's API has
 * no page numbers — only a token for the next page — so this is the same control
 * Gmail itself uses. The total is a real count (see /api/gmail/list-count), "many"
 * until it's known, and "20,000+" past the counting cap.
 */
export function MailPager({ start, end, totalText, hasNewer, hasOlder, onNewer, onOlder, busy, compact }: Props) {
  const arrow =
    "inline-flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-muted)] transition-colors enabled:hover:bg-[var(--color-surface-offset)] enabled:hover:text-[var(--color-text)] disabled:cursor-default disabled:opacity-35";
  return (
    <div data-testid="mail-pager" className="ml-auto flex shrink-0 items-center gap-1 text-[12px] text-[var(--color-text-muted)]">
      {!compact && (
        <span data-testid="mail-pager-range" className={cn("mr-1 tabular-nums", busy && "opacity-60")}>
          {start.toLocaleString()}–{end.toLocaleString()} of {totalText}
        </span>
      )}
      <button
        type="button"
        data-testid="mail-pager-newer"
        className={arrow}
        disabled={!hasNewer}
        onClick={onNewer}
        aria-label="Newer"
        title="Newer"
      >
        <ChevronLeft className="h-4 w-4" strokeWidth={2} />
      </button>
      <button
        type="button"
        data-testid="mail-pager-older"
        className={arrow}
        disabled={!hasOlder}
        onClick={onOlder}
        aria-label="Older"
        title="Older"
      >
        <ChevronRight className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}
