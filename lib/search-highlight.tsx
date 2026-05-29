import type { ReactNode } from "react";
import { isPlainTextSearch, normalizeGmailSearchQuery, tokenizeGmailQuery } from "@/lib/gmail-search-query";

/** Terms to highlight in list rows for a plain-text search query. */
export function searchHighlightTerms(query: string): string[] {
  if (!isPlainTextSearch(query)) return [];
  return tokenizeGmailQuery(normalizeGmailSearchQuery(query))
    .map((t) => t.replace(/^"|"$/g, "").trim())
    .filter((t) => t.length > 0 && !t.startsWith("-"));
}

type HighlightProps = {
  text: string;
  terms: string[];
  className?: string;
};

/**
 * Gmail-style yellow highlight for search hits in sender / subject / snippet.
 */
export function SearchHighlight({ text, terms, className }: HighlightProps) {
  if (!text || terms.length === 0) return <>{text}</>;

  const lower = text.toLowerCase();
  const matches: { start: number; end: number }[] = [];

  for (const term of terms) {
    const tl = term.toLowerCase();
    if (!tl) continue;
    let from = 0;
    while (from < lower.length) {
      const idx = lower.indexOf(tl, from);
      if (idx < 0) break;
      matches.push({ start: idx, end: idx + tl.length });
      from = idx + tl.length;
    }
  }

  if (matches.length === 0) return <span className={className}>{text}</span>;

  matches.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const m of matches) {
    const last = merged[merged.length - 1];
    if (!last || m.start > last.end) merged.push({ ...m });
    else last.end = Math.max(last.end, m.end);
  }

  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const m of merged) {
    if (m.start > cursor) nodes.push(text.slice(cursor, m.start));
    nodes.push(
      <mark
        key={`${m.start}-${m.end}`}
        className="rounded-sm bg-[#fce8b2] px-0.5 font-inherit text-inherit"
      >
        {text.slice(m.start, m.end)}
      </mark>,
    );
    cursor = m.end;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));

  return <span className={className}>{nodes}</span>;
}
