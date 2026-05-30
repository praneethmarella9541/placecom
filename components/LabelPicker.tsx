"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { labelDisplayName, buildLabelColorMap, type LabelLike } from "@/components/LabelChip";

type Label = LabelLike & {
  id: string;
  name: string;
  type?: "system" | "user";
  surfaced?: boolean;
};

const MENU_WIDTH = 280;
const MENU_MAX_HEIGHT = 320;

/**
 * Gmail-style "Labels" dropdown: search + user-label checklist + create.
 * Menu is portaled to document.body with viewport-aware positioning so it
 * is never clipped by overflow:hidden ancestors (thread toolbar, etc.).
 */
export function LabelPicker({
  allLabels,
  selected,
  onToggle,
  onCreate,
  align = "right",
}: {
  allLabels: Label[];
  selected: Set<string>;
  onToggle: (labelId: string, nextChecked: boolean) => void;
  onCreate: (name: string) => Promise<void> | void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number } | null>(null);
  /** Local overrides so checkboxes flip on click before parent state catches up. */
  const [pendingChecks, setPendingChecks] = useState<Map<string, boolean>>(new Map());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const effectiveSelected = useMemo(() => {
    const next = new Set(selected);
    pendingChecks.forEach((checked, id) => {
      if (checked) next.add(id);
      else next.delete(id);
    });
    return next;
  }, [selected, pendingChecks]);

  useEffect(() => {
    setPendingChecks((prev) => {
      if (prev.size === 0) return prev;
      let changed = false;
      const next = new Map(prev);
      prev.forEach((checked, id) => {
        if (selected.has(id) === checked) {
          next.delete(id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [selected]);

  function handleToggle(labelId: string, checked: boolean) {
    setPendingChecks((prev) => new Map(prev).set(labelId, checked));
    onToggle(labelId, checked);
  }

  const userLabels = useMemo(
    () => allLabels.filter((l) => l.type === "user"),
    [allLabels]
  );

  const labelColorMap = useMemo(() => buildLabelColorMap(userLabels), [userLabels]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (!open || !buttonRef.current) return;

    function positionMenu() {
      const rect = buttonRef.current!.getBoundingClientRect();
      let left = align === "right" ? rect.right - MENU_WIDTH : rect.left;
      left = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));

      const menuH = menuRef.current?.offsetHeight ?? MENU_MAX_HEIGHT;
      let top = rect.bottom + 4;
      if (top + menuH > window.innerHeight - 8) {
        top = Math.max(8, rect.top - menuH - 4);
      }

      setMenuStyle({ top, left });
    }

    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, align, query, userLabels.length]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return userLabels;
    return userLabels.filter((l) => labelDisplayName(l).toLowerCase().includes(q));
  }, [userLabels, query]);

  const showCreate =
    query.trim().length > 0 &&
    !userLabels.some(
      (l) => l.name.toLowerCase() === query.trim().toLowerCase()
    );

  async function handleCreate() {
    const name = query.trim();
    if (!name || creating) return;
    setQuery("");
    setCreating(true);
    try {
      await onCreate(name);
    } finally {
      setCreating(false);
    }
  }

  const menu =
    open && menuStyle ? (
      <div
        ref={menuRef}
        style={{ position: "fixed", top: menuStyle.top, left: menuStyle.left, width: MENU_WIDTH, zIndex: 9999 }}
        className="overflow-hidden rounded-lg border border-[#dadce0] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.2)]"
      >
        <div className="border-b border-[#e8eaed] p-2">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Label as…"
            className="w-full rounded-md border border-[#dadce0] bg-white px-2 py-1.5 text-[13px] text-[#202124] outline-none focus:border-[#0b57d0] focus:ring-1 focus:ring-[#0b57d0]"
          />
        </div>
        <div className="max-h-[280px] overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-[#5f6368]">No matching labels.</p>
          )}
          {filtered.map((l) => {
            const checked = effectiveSelected.has(l.id);
            const accent = labelColorMap.get(l.id);
            return (
              <label
                key={l.id}
                className="flex cursor-pointer items-center gap-2 px-3 py-2 text-[13px] hover:bg-[#f1f3f4]"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => handleToggle(l.id, e.target.checked)}
                  className="accent-[#0b57d0]"
                />
                {accent ? (
                  <span
                    className="h-3 w-3 shrink-0 rounded-full border"
                    style={{
                      backgroundColor: accent.bg,
                      borderColor: accent.border,
                    }}
                    aria-hidden
                  />
                ) : null}
                <span className="min-w-0 flex-1 truncate text-[#202124]">{labelDisplayName(l)}</span>
              </label>
            );
          })}
        </div>
        {showCreate && (
          <div className="border-t border-[#e8eaed]">
            <button
              type="button"
              onClick={() => void handleCreate()}
              disabled={creating}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-[#0b57d0] hover:bg-[#f1f3f4] disabled:opacity-50"
            >
              {creating ? "Creating…" : `Create "${query.trim()}"`}
            </button>
          </div>
        )}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#dadce0] bg-white px-2.5 py-1.5 text-[12px] font-medium text-[#444746] transition-colors hover:bg-[#f1f3f4]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M20.59 13.41 13.41 20.6a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
          <line x1="7" y1="7" x2="7.01" y2="7" />
        </svg>
        Labels
      </button>
      {typeof document !== "undefined" && menu ? createPortal(menu, document.body) : null}
    </>
  );
}
