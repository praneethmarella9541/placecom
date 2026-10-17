"use client";

import { useEffect, useRef, useState } from "react";

export type SuggestionItem = { label: string; value: string; sub?: string; logo?: string };

type Props = {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
  /** Suggestions for the entry being typed (the text after the last comma). Return [] for none. */
  getSuggestions: (term: string) => Promise<SuggestionItem[]>;
};

/**
 * A text box holding a comma-separated list, with suggestions for the entry being typed. Picking
 * one replaces just that entry and starts the next. Typing anything else still works.
 */
export function SuggestListInput({ value, onChange, placeholder, className, getSuggestions }: Props) {
  const [items, setItems] = useState<SuggestionItem[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const seq = useRef(0);
  const box = useRef<HTMLDivElement>(null);

  const cut = value.lastIndexOf(",");
  const term = value.slice(cut + 1).trim();

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
      if (mine !== seq.current) return;
      setItems(found.filter((f) => f.value.toLowerCase() !== term.toLowerCase()));
      setActive(-1);
    }, 400);
    return () => clearTimeout(t);
    // getSuggestions is stable per field; the term is what should retrigger a lookup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [term]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function pick(item: SuggestionItem) {
    const head = cut >= 0 ? `${value.slice(0, cut + 1).trimEnd()} ` : "";
    onChange(`${head}${item.value}, `);
    setItems([]);
    setActive(-1);
  }

  const show = open && items.length > 0;

  return (
    <div ref={box} className="relative">
      <input
        className={className}
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (!show) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => (a + 1) % items.length);
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => (a <= 0 ? items.length - 1 : a - 1));
          } else if (e.key === "Enter" && active >= 0) {
            e.preventDefault();
            pick(items[active]);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {show ? (
        <ul
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-56 overflow-auto rounded-lg border border-[var(--color-border)] bg-white py-1 text-[13px] font-normal shadow-lg"
        >
          {items.map((s, i) => (
            <li
              key={`${s.value}|${s.label}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => {
                e.preventDefault();
                pick(s);
              }}
              className={`cursor-pointer px-3 py-1.5 text-[var(--color-text)] ${i === active ? "bg-[var(--color-surface-2)]" : "hover:bg-[var(--color-surface-2)]"}`}
            >
              <span className="flex items-center gap-2.5">
                {s.logo ? (
                  // eslint-disable-next-line @next/next/no-img-element -- small remote logo from Lusha
                  <img src={s.logo} alt="" loading="lazy" className="h-7 w-7 shrink-0 rounded object-contain" />
                ) : null}
                <span className="min-w-0">
                  <span className="block truncate">{s.label}</span>
                  {s.sub ? <span className="block truncate text-[11.5px] text-[var(--color-text-faint)]">{s.sub}</span> : null}
                </span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
