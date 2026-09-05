"use client";

import { useCallback, useState } from "react";
import { titleCase } from "@/lib/title-case";

/** Cards rendered per bucket before "show more" — see useBucketLimit. */
export const BUCKET_PAGE_SIZE = 60;

/**
 * Per-bucket render caps for the synced lists.
 *
 * These lists are grouped by connection strength, and a single bucket
 * ("Very weak", typically) holds most of a multi-thousand-row mailbox. Rendering
 * every card in every bucket built tens of thousands of DOM nodes before the
 * page was interactive. Filtering and grouping still run over the full set —
 * only how many of each group are *drawn* is capped.
 */
export function useBucketLimit() {
  const [limits, setLimits] = useState<Record<string, number>>({});

  const limitFor = useCallback(
    (key: string) => limits[key] ?? BUCKET_PAGE_SIZE,
    [limits]
  );

  const showMore = useCallback((key: string) => {
    setLimits((prev) => ({ ...prev, [key]: (prev[key] ?? BUCKET_PAGE_SIZE) + BUCKET_PAGE_SIZE }));
  }, []);

  return { limitFor, showMore };
}

export function ShowMoreRow({
  shown,
  total,
  onShowMore,
}: {
  shown: number;
  total: number;
  onShowMore: () => void;
}) {
  if (shown >= total) return null;
  return (
    <div className="flex items-center justify-center gap-3 py-1">
      <span className="text-[12px] text-[var(--color-text-muted)]">
        {titleCase(`Showing ${shown} of ${total}`)}
      </span>
      <button type="button" onClick={onShowMore} className="btn-secondary h-8 px-3 text-[12.5px]">
        {titleCase("Show more")}
      </button>
    </div>
  );
}
