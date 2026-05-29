"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconSearch, IconX } from "@/components/Icons";
import { GmailAvatar } from "@/components/GmailAvatar";
import { extractEmailAddress } from "@/lib/email-parse";
import { gmailWebSearchUrl } from "@/lib/gmail-search-query";
import { titleCase } from "@/lib/title-case";
import { cn } from "@/lib/utils";
import { Loader2, Mail, Paperclip, SlidersHorizontal } from "lucide-react";
import type { RecipientSuggestion } from "@/components/RecipientField";

export type SearchSuggestContact = {
  email: string;
  displayName?: string;
};

export type SearchSuggestThread = {
  id: string;
  subject: string;
  from: string;
  participants: string;
  date: string;
  hasAttachments?: boolean;
};

const QUICK_FILTERS = [
  { label: "Has attachment", modifier: "has:attachment" },
  { label: "Last 7 days", modifier: "newer_than:7d" },
  { label: "From me", modifier: "from:me" },
] as const;

type Props = {
  inputValue: string;
  onInputChange: (value: string) => void;
  activeQuery: string;
  onSearch: (query: string) => void;
  onReset: () => void;
  filterOpen: boolean;
  onFilterOpenChange: (open: boolean) => void;
  localContacts: RecipientSuggestion[];
  onOpenThread: (threadId: string) => void;
  /** True while the suggest dropdown is open — parent can defer live list search until Enter. */
  onSuggestingChange?: (suggesting: boolean) => void;
};

function suggestDateLabel(iso: string): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) {
      return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(d);
    }
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(d);
  } catch {
    return "";
  }
}

function contactShowsName(c: SearchSuggestContact): boolean {
  return Boolean(
    c.displayName && c.displayName.trim().toLowerCase() !== c.email.trim().toLowerCase(),
  );
}

function pickLocalCompletion(
  contacts: SearchSuggestContact[],
  query: string,
): string | undefined {
  const ql = query.trim().toLowerCase();
  if (!ql) return undefined;
  for (const c of contacts) {
    const em = c.email.toLowerCase();
    if (em.startsWith(ql) && em.length > ql.length) return c.email;
  }
  return undefined;
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q || !text) return <>{text}</>;
  const lower = text.toLowerCase();
  const qi = lower.indexOf(q.toLowerCase());
  if (qi < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, qi)}
      <span className="font-semibold text-[var(--color-text)]">{text.slice(qi, qi + q.length)}</span>
      {text.slice(qi + q.length)}
    </>
  );
}

export function MailSearchBar({
  inputValue,
  onInputChange,
  activeQuery,
  onSearch,
  onReset,
  filterOpen,
  onFilterOpenChange,
  localContacts,
  onOpenThread,
  onSuggestingChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [contacts, setContacts] = useState<SearchSuggestContact[]>([]);
  const [threads, setThreads] = useState<SearchSuggestThread[]>([]);
  const [completionEmail, setCompletionEmail] = useState<string | undefined>();
  /** -1 = nothing highlighted; Enter runs full search for typed text (Gmail default). */
  const [highlight, setHighlight] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetchRef = useRef(0);

  const q = inputValue.trim();
  const showDropdown = focused && q.length >= 1 && !filterOpen;

  useEffect(() => {
    onSuggestingChange?.(showDropdown);
  }, [showDropdown, onSuggestingChange]);

  useEffect(() => {
    setHighlight(-1);
  }, [q, showDropdown]);

  const localHits = useMemo(() => {
    if (q.length < 1) return [];
    const ql = q.toLowerCase();
    return localContacts
      .filter((c) => {
        const em = c.email.toLowerCase();
        const name = (c.displayName || "").toLowerCase();
        return em.includes(ql) || name.includes(ql);
      })
      .slice(0, 4)
      .map((c) => ({ email: c.email, displayName: c.displayName }));
  }, [localContacts, q]);

  const mergedContacts = useMemo(() => {
    const seen = new Set<string>();
    const out: SearchSuggestContact[] = [];
    for (const c of [...contacts, ...localHits]) {
      const em = c.email.toLowerCase();
      if (seen.has(em)) continue;
      seen.add(em);
      out.push(c);
    }
    return out.slice(0, 6);
  }, [contacts, localHits]);

  const itemCount = mergedContacts.length + threads.length + 1;

  const effectiveCompletion = useMemo(
    () => completionEmail ?? pickLocalCompletion(mergedContacts, q),
    [completionEmail, mergedContacts, q],
  );

  const completionSuffix = useMemo(() => {
    if (!effectiveCompletion || !q) return "";
    const lower = effectiveCompletion.toLowerCase();
    const ql = q.toLowerCase();
    if (!lower.startsWith(ql) || lower === ql) return "";
    return effectiveCompletion.slice(q.length);
  }, [effectiveCompletion, q]);

  useEffect(() => {
    if (!showDropdown) return;
    const id = ++fetchRef.current;
    setLoading(true);
    const t = setTimeout(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/gmail/search/suggest?${new URLSearchParams({ q }).toString()}`,
            { cache: "no-store" },
          );
          const data = (await res.json()) as {
            contacts?: SearchSuggestContact[];
            threads?: SearchSuggestThread[];
            completionEmail?: string;
          };
          if (fetchRef.current !== id) return;
          setContacts(data.contacts ?? []);
          setThreads(data.threads ?? []);
          setCompletionEmail(data.completionEmail);
        } catch {
          if (fetchRef.current !== id) return;
          setContacts([]);
          setThreads([]);
        } finally {
          if (fetchRef.current === id) setLoading(false);
        }
      })();
    }, 180);
    return () => clearTimeout(t);
  }, [q, showDropdown]);

  useEffect(() => {
    if (!showDropdown) return;
    function onDocDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [showDropdown]);

  const submitSearch = useCallback(
    (query: string) => {
      const t = query.trim();
      if (!t) return;
      onSearch(t);
      setFocused(false);
    },
    [onSearch],
  );

  const acceptCompletion = useCallback(() => {
    if (effectiveCompletion) {
      onInputChange(effectiveCompletion);
      inputRef.current?.focus();
    }
  }, [effectiveCompletion, onInputChange]);

  const applyQuickFilter = useCallback(
    (modifier: string) => {
      const base = inputValue.trim();
      const next = base ? `${base} ${modifier}` : modifier;
      onInputChange(next);
      submitSearch(next);
    },
    [inputValue, onInputChange, submitSearch],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Tab" && completionSuffix && !e.shiftKey) {
      e.preventDefault();
      acceptCompletion();
      return;
    }
    if (!showDropdown) {
      if (e.key === "Enter") {
        e.preventDefault();
        submitSearch(inputValue);
      }
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      setFocused(false);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => (h < 0 ? 0 : Math.min(h + 1, itemCount - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h <= 0 ? -1 : h - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      if (highlight < 0) {
        submitSearch(inputValue);
        return;
      }
      if (highlight < mergedContacts.length) {
        const c = mergedContacts[highlight];
        if (c) {
          onInputChange(c.email);
          submitSearch(c.email);
        }
        return;
      }
      const ti = highlight - mergedContacts.length;
      if (ti < threads.length) {
        const th = threads[ti];
        if (th) {
          submitSearch(q);
          onOpenThread(th.id);
        }
        return;
      }
      submitSearch(inputValue);
    }
  }

  let rowIndex = 0;

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <IconSearch className="pointer-events-none absolute left-3 top-1/2 z-20 h-4 w-4 -translate-y-1/2 text-[#5f6368]" />
        {completionSuffix && focused ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 flex items-center overflow-hidden rounded-full pl-10 pr-[4.5rem] text-[16px] md:text-[14px]"
          >
            <span className="invisible whitespace-pre">{inputValue}</span>
            <span className="whitespace-pre text-[#9aa0a6]">{completionSuffix}</span>
            <span className="ml-2 rounded border border-[#dadce0] px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[#5f6368]">
              tab
            </span>
          </div>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          role="searchbox"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={onKeyDown}
          placeholder={titleCase("Search mail")}
          className={cn(
            "relative z-[11] h-[46px] w-full rounded-full border border-transparent bg-[#eaf1fb] pl-10 text-[16px] text-[#202124] outline-none transition focus:border-[#0b57d0] focus:bg-white focus:shadow-[0_1px_3px_rgba(60,64,67,0.3)] md:text-[14px]",
            inputValue.trim() ? "pr-[4.5rem]" : "pr-10",
          )}
          autoComplete="off"
        />
        {inputValue.trim() ? (
          <button
            type="button"
            onClick={onReset}
            className="absolute right-10 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[#5f6368] hover:bg-[#dadce0]"
            aria-label={titleCase("Clear search")}
          >
            <IconX className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => onFilterOpenChange(!filterOpen)}
          className="absolute right-2 top-1/2 z-20 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          aria-label={titleCase("Show search options")}
        >
          <SlidersHorizontal className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>

      {activeQuery && !showDropdown ? (
        <p className="mt-1.5 px-1 text-[11px] text-[#5f6368]">
          Results use the Gmail API with your exact query.{" "}
          <a
            href={gmailWebSearchUrl(activeQuery)}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-[var(--color-primary)] hover:underline"
          >
            Compare in Gmail
          </a>
        </p>
      ) : null}

      {showDropdown ? (
        <div className="mt-2 flex flex-wrap gap-2 px-0.5">
          {QUICK_FILTERS.map(({ label, modifier }) => (
            <button
              key={modifier}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => applyQuickFilter(modifier)}
              className="rounded-full border border-[#dadce0] bg-white px-3 py-1 text-[13px] text-[#3c4043] shadow-sm transition hover:bg-[#f1f3f4]"
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {showDropdown ? (
        <div
          className="absolute left-0 right-0 top-[calc(100%+44px)] z-30 overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-[0_4px_16px_rgba(60,64,67,0.28)]"
          role="listbox"
        >
          {loading && mergedContacts.length === 0 && threads.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[13px] text-[#5f6368]">
              <Loader2 className="h-4 w-4 animate-spin" />
              {titleCase("Searching…")}
            </div>
          ) : null}

          {mergedContacts.map((c, i) => {
            const idx = rowIndex++;
            const active = highlight === idx;
            const named = contactShowsName(c);
            return (
              <button
                key={c.email}
                type="button"
                role="option"
                aria-selected={active && highlight >= 0}
                className={cn(
                  "flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors",
                  i > 0 && "border-t border-[#f1f3f4]",
                  active ? "bg-[#e8f0fe]" : "hover:bg-[#f1f3f4]",
                )}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => {
                  onInputChange(c.email);
                  submitSearch(c.email);
                }}
              >
                <GmailAvatar seed={c.email} name={c.displayName || c.email} size={36} />
                <div className="min-w-0 flex-1">
                  {named ? (
                    <>
                      <p className="truncate text-[14px] font-medium text-[#202124]">
                        <HighlightMatch text={c.displayName!} query={q} />
                      </p>
                      <p className="truncate text-[12px] text-[#5f6368]">
                        <HighlightMatch text={c.email} query={q} />
                      </p>
                    </>
                  ) : (
                    <p className="truncate text-[14px] text-[#202124]">
                      <HighlightMatch text={c.email} query={q} />
                    </p>
                  )}
                </div>
              </button>
            );
          })}

          {threads.length > 0 && mergedContacts.length > 0 ? (
            <div className="border-t border-[#e8eaed]" aria-hidden />
          ) : null}

          {threads.map((t) => {
            const idx = rowIndex++;
            const active = highlight === idx;
            const people = t.participants || extractEmailAddress(t.from) || "";
            return (
              <button
                key={t.id}
                type="button"
                role="option"
                aria-selected={active && highlight >= 0}
                className={cn(
                  "flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors",
                  active ? "bg-[#e8f0fe]" : "hover:bg-[#f1f3f4]",
                )}
                onMouseEnter={() => setHighlight(idx)}
                onClick={() => {
                  submitSearch(q);
                  onOpenThread(t.id);
                }}
              >
                <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#f1f3f4] text-[#5f6368]">
                  <Mail className="h-4 w-4" strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <p className="min-w-0 flex-1 truncate text-[14px] font-medium text-[#202124]">
                      {t.subject || "(no subject)"}
                    </p>
                    <span className="flex shrink-0 items-center gap-1 text-[11px] text-[#5f6368]">
                      {t.hasAttachments ? (
                        <Paperclip className="h-3.5 w-3.5" strokeWidth={2} aria-label="Has attachment" />
                      ) : null}
                      {suggestDateLabel(t.date)}
                    </span>
                  </div>
                  {people ? (
                    <p className="truncate text-[12px] text-[#5f6368]">
                      <HighlightMatch text={people} query={q} />
                    </p>
                  ) : null}
                </div>
              </button>
            );
          })}

          <button
            type="button"
            role="option"
            aria-selected={highlight === itemCount - 1}
            className={cn(
              "flex w-full items-center justify-between gap-2 border-t border-[#dadce0] px-4 py-3 text-left text-[13px] transition-colors",
              highlight === itemCount - 1 ? "bg-[#e8f0fe]" : "hover:bg-[#f1f3f4]",
            )}
            onMouseEnter={() => setHighlight(itemCount - 1)}
            onClick={() => submitSearch(inputValue)}
          >
            <span className="flex items-center gap-2 text-[#202124]">
              <IconSearch className="h-4 w-4 text-[#5f6368]" />
              {`All search results for "${q}"`}
            </span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-[#5f6368]">
              Press Enter
            </span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
