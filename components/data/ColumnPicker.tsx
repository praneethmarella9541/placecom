"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Columns3 } from "lucide-react";
import type { AttributeDef } from "@/lib/data-model/types";

/** Pick which fields show as columns, and in what order. `selected` is a list of attribute slugs. */
export function ColumnPicker({
  attributes,
  selected,
  onChange,
}: {
  attributes: AttributeDef[];
  selected: string[];
  onChange: (slugs: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  const bySlug = new Map(attributes.map((a) => [a.slug, a]));
  const chosen = selected.filter((s) => bySlug.has(s));
  const rest = attributes.filter((a) => !chosen.includes(a.slug));

  function move(slug: string, by: -1 | 1) {
    const i = chosen.indexOf(slug);
    const j = i + by;
    if (i < 0 || j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  }

  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="btn-ghost inline-flex h-9 items-center gap-1.5 px-3 text-[12.5px]">
        <Columns3 className="h-3.5 w-3.5" /> Columns
      </button>
      {open && (
        <div role="dialog" aria-label="Columns" className="absolute right-0 z-30 mt-1 w-[280px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-[var(--shadow-lg)]">
          <p className="px-2 pb-1 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Showing</p>
          <ul>
            {chosen.map((slug, i) => (
              <li key={slug} className="flex items-center gap-1 rounded px-2 py-1 text-[13px] hover:bg-[var(--color-surface-2)]">
                <label className="flex flex-1 items-center gap-2">
                  <input type="checkbox" checked onChange={() => onChange(chosen.filter((s) => s !== slug))} />
                  {bySlug.get(slug)!.name}
                </label>
                <button type="button" aria-label={`Move ${bySlug.get(slug)!.name} left`} disabled={i === 0} onClick={() => move(slug, -1)} className="p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)] disabled:opacity-30">
                  <ArrowUp className="h-3.5 w-3.5" />
                </button>
                <button type="button" aria-label={`Move ${bySlug.get(slug)!.name} right`} disabled={i === chosen.length - 1} onClick={() => move(slug, 1)} className="p-1 text-[var(--color-text-faint)] hover:text-[var(--color-text)] disabled:opacity-30">
                  <ArrowDown className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
          {rest.length > 0 && (
            <>
              <p className="px-2 pb-1 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Hidden</p>
              <ul>
                {rest.map((a) => (
                  <li key={a.slug} className="rounded px-2 py-1 text-[13px] hover:bg-[var(--color-surface-2)]">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={false} onChange={() => onChange([...chosen, a.slug])} />
                      {a.name}
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="px-2 pt-2 text-[12px] text-[var(--color-text-faint)]">The name column always shows.</p>
        </div>
      )}
    </div>
  );
}
