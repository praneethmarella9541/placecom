"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import type { SuggestionItem } from "@/components/SuggestListInput";

type Props = {
  chips: SuggestionItem[];
  onChange: (chips: SuggestionItem[]) => void;
  placeholder?: string;
  getSuggestions: (term: string) => Promise<SuggestionItem[]>;
};

/** Pick several places (or similar): suggestions as you type, each choice becomes a removable chip. */
export function SuggestChipsInput({ chips, onChange, placeholder, getSuggestions }: Props) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);
  const term = text.trim();

  useEffect(() => {
    if (term.length < 2) {
      setItems([]);
      return;
    }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      let found: SuggestionItem[] = [];
      try {
        found = await getSuggestions(term);
      } catch {
        found = [];
      }
      if (mine === seq.current) setItems(found.filter((f) => !chips.some((c) => c.value === f.value)));
    }, 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  return (
    <div ref={box} className="relative">
      <div className="input-field flex min-h-[38px] flex-wrap items-center gap-1.5 !py-1">
        {chips.map((c) => (
          <span key={c.value} className="inline-flex items-center gap-1 rounded-full bg-[var(--color-surface-2)] px-2.5 py-0.5 text-[12px] text-[var(--color-text)]">
            {c.label}
            <button type="button" aria-label={`Remove ${c.label}`} onClick={() => onChange(chips.filter((x) => x.value !== c.value))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          className="min-w-[120px] flex-1 bg-transparent text-[13px] outline-none"
          value={text}
          placeholder={chips.length === 0 ? placeholder : ""}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !text && chips.length) onChange(chips.slice(0, -1));
            if (e.key === "Escape") setOpen(false);
          }}
        />
      </div>
      {open && items.length > 0 ? (
        <ul role="listbox" className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-[var(--color-border)] bg-white py-1 text-[13px] shadow-lg">
          {items.map((s) => (
            <li
              key={s.value}
              role="option"
              aria-selected={false}
              className="cursor-pointer px-3 py-1.5 text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
              onMouseDown={(e) => {
                e.preventDefault();
                onChange([...chips, s]);
                setText("");
                setItems([]);
              }}
            >
              {s.label}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
