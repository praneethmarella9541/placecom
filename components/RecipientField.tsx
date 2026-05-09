"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { IconX } from "@/components/Icons";
import { extractEmailAddress } from "@/lib/email-parse";
import {
  isCompleteEmailAddress,
  parseRecipientValue,
  serializeRecipientValue,
  type RecipientChipData,
} from "@/lib/email-recipients";
import { cn } from "@/lib/utils";

export type RecipientSuggestion = {
  email: string;
  displayName?: string;
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  suggestions: RecipientSuggestion[];
  id?: string;
  className?: string;
};

function chipLabel(chip: RecipientChipData): string {
  return chip.displayName?.trim() || chip.email;
}

function chipInitial(chip: RecipientChipData): string {
  const label = chipLabel(chip);
  const ch = label.charAt(0);
  return ch ? ch.toUpperCase() : "?";
}

export function RecipientField({
  value,
  onChange,
  placeholder,
  suggestions,
  id,
  className,
}: Props) {
  const [chips, setChips] = useState<RecipientChipData[]>([]);
  const [draft, setDraft] = useState("");
  const lastEmittedRef = useRef("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [highlight, setHighlight] = useState(0);
  const [pickerDismissed, setPickerDismissed] = useState(false);

  const emit = useCallback(
    (nextChips: RecipientChipData[], nextDraft: string) => {
      const s = serializeRecipientValue(nextChips, nextDraft);
      lastEmittedRef.current = s;
      onChange(s);
    },
    [onChange],
  );

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    lastEmittedRef.current = value;
    const p = parseRecipientValue(value);
    setChips(p.chips);
    setDraft(p.draft);
  }, [value]);

  useEffect(() => {
    setPickerDismissed(false);
  }, [draft]);

  const filtered = useMemo(() => {
    const q = draft.trim().toLowerCase();
    if (!q) return [];
    return suggestions
      .filter((s) => {
        const em = s.email.toLowerCase();
        const name = (s.displayName || "").toLowerCase();
        return em.includes(q) || name.includes(q);
      })
      .slice(0, 10);
  }, [draft, suggestions]);

  const showDropdown = !pickerDismissed && draft.trim().length > 0 && filtered.length > 0;

  useEffect(() => {
    setHighlight(0);
  }, [filtered.length, draft]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight]);

  function addChip(chip: RecipientChipData) {
    const email = chip.email.trim().toLowerCase();
    if (!email) return;
    if (chips.some((c) => c.email === email)) {
      setDraft("");
      emit(chips, "");
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    const next = [...chips, { ...chip, email }];
    setChips(next);
    setDraft("");
    emit(next, "");
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function removeChip(index: number) {
    const next = chips.filter((_, j) => j !== index);
    setChips(next);
    emit(next, draft);
  }

  function applySuggestion(s: RecipientSuggestion) {
    addChip({
      email: s.email.trim().toLowerCase(),
      displayName: s.displayName?.trim() || undefined,
    });
  }

  function handleDraftChange(raw: string) {
    if (raw.includes(",")) {
      const segments = raw.split(",");
      const completed = segments.slice(0, -1);
      const remainder = segments[segments.length - 1] ?? "";
      const nextChips = [...chips];
      for (const seg of completed) {
        const t = seg.trim();
        if (!t) continue;
        if (isCompleteEmailAddress(t)) {
          const email = extractEmailAddress(t).trim().toLowerCase();
          if (!nextChips.some((c) => c.email === email)) {
            nextChips.push({ email });
          }
        }
      }
      setChips(nextChips);
      setDraft(remainder);
      emit(nextChips, remainder);
      return;
    }
    setDraft(raw);
    emit(chips, raw);
  }

  function onInputKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (showDropdown) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlight((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlight((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const pick = filtered[highlight] ?? filtered[0];
        if (pick) applySuggestion(pick);
      } else if (e.key === "Escape") {
        e.preventDefault();
        setPickerDismissed(true);
      }
      return;
    }

    if (e.key === "Enter" && draft.trim() && isCompleteEmailAddress(draft)) {
      e.preventDefault();
      addChip({ email: extractEmailAddress(draft).trim().toLowerCase() });
      return;
    }

    if (e.key === "Backspace" && !draft && chips.length > 0) {
      e.preventDefault();
      removeChip(chips.length - 1);
    }
  }

  function onPaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes(",") && !text.includes(";")) return;
    e.preventDefault();
    const normalized = text.replace(/;/g, ",").trim();
    const parsed = parseRecipientValue(normalized);
    const seen = new Set(chips.map((c) => c.email));
    const merged: RecipientChipData[] = [...chips];
    for (const c of parsed.chips) {
      if (!seen.has(c.email)) {
        seen.add(c.email);
        merged.push(c);
      }
    }
    setChips(merged);
    setDraft(parsed.draft);
    emit(merged, parsed.draft);
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <div
        role="group"
        aria-label={placeholder}
        className={cn(
          "flex min-h-[42px] flex-wrap items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1.5 text-sm transition-colors",
          "focus-within:border-[var(--color-primary)] focus-within:shadow-[0_0_0_3px_var(--color-primary-light)]",
        )}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest("[data-chip-remove]")) return;
          if (e.target === inputRef.current) return;
          if ((e.target as HTMLElement).closest("input")) return;
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        {chips.map((chip, i) => (
          <span
            key={`${chip.email}-${i}`}
            className="inline-flex max-w-full items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-offset)] pl-1 pr-0.5 py-0.5 text-[13px]"
          >
            <span
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[11px] font-semibold text-white"
              aria-hidden
            >
              {chipInitial(chip)}
            </span>
            <span className="max-w-[180px] truncate font-medium text-[var(--color-text)]">
              {chipLabel(chip)}
            </span>
            <button
              type="button"
              data-chip-remove
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[var(--color-text-faint)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
              aria-label={`Remove ${chip.email}`}
              onClick={(e) => {
                e.stopPropagation();
                removeChip(i);
                inputRef.current?.focus();
              }}
            >
              <IconX className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={draft}
          onChange={(e) => handleDraftChange(e.target.value)}
          onKeyDown={onInputKeyDown}
          onPaste={onPaste}
          placeholder={chips.length === 0 ? placeholder : ""}
          className="min-w-[8rem] flex-1 border-0 bg-transparent py-1 text-[var(--color-text)] outline-none placeholder:text-[var(--color-text-faint)]"
        />
      </div>

      {showDropdown ? (
        <ul
          ref={listRef}
          role="listbox"
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-[1001] max-h-52 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-md)]"
        >
          {filtered.map((s, i) => (
            <li key={`${s.email}-${i}`} role="option" aria-selected={i === highlight}>
              <button
                type="button"
                data-idx={i}
                className={cn(
                  "flex w-full flex-col gap-0.5 px-3 py-2 text-left text-sm transition-colors",
                  i === highlight
                    ? "bg-[var(--color-primary-light)]"
                    : "hover:bg-[var(--color-surface-offset)]",
                )}
                onMouseEnter={() => setHighlight(i)}
                onMouseDown={(ev) => ev.preventDefault()}
                onClick={() => applySuggestion(s)}
              >
                <span className="truncate font-medium text-[var(--color-text)]">
                  {s.displayName?.trim() || s.email}
                </span>
                {s.displayName?.trim() ? (
                  <span className="truncate text-xs text-[var(--color-text-muted)]">{s.email}</span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
