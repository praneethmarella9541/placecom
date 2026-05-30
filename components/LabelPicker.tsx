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
const MENU_MAX_HEIGHT = 360;

/**
 * Gmail-style "Labels" dropdown: search + user-label checklist + create / edit / delete.
 */
export function LabelPicker({
  allLabels,
  selected,
  onToggle,
  onCreate,
  onEdit,
  onDelete,
  align = "right",
}: {
  allLabels: Label[];
  selected: Set<string>;
  onToggle: (labelId: string, nextChecked: boolean) => void;
  onCreate: (name: string) => Promise<void> | void;
  onEdit?: (labelId: string, newName: string) => Promise<void> | void;
  onDelete?: (labelId: string) => Promise<void> | void;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [createMode, setCreateMode] = useState(false);
  const [newLabelName, setNewLabelName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number } | null>(null);
  const [pendingChecks, setPendingChecks] = useState<Map<string, boolean>>(new Map());
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

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
    () => allLabels.filter((l) => l.type === "user" && !l.id.startsWith("pending:")),
    [allLabels]
  );

  const labelColorMap = useMemo(() => buildLabelColorMap(userLabels), [userLabels]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setCreateMode(false);
      setEditingId(null);
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
  }, [open, align, query, userLabels.length, createMode, editingId]);

  useEffect(() => {
    if (createMode) createInputRef.current?.focus();
  }, [createMode]);

  useEffect(() => {
    if (editingId) editInputRef.current?.focus();
  }, [editingId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return userLabels;
    return userLabels.filter((l) => labelDisplayName(l).toLowerCase().includes(q));
  }, [userLabels, query]);

  const showCreateFromSearch =
    query.trim().length > 0 &&
    !userLabels.some(
      (l) => l.name.toLowerCase() === query.trim().toLowerCase()
    );

  function submitCreate(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setQuery("");
    setNewLabelName("");
    setCreateMode(false);
    void Promise.resolve(onCreate(trimmed));
  }

  function submitEdit(labelId: string) {
    const trimmed = editName.trim();
    if (!trimmed || !onEdit) return;
    setEditingId(null);
    onEdit(labelId, trimmed);
  }

  function submitDelete(labelId: string, displayName: string) {
    if (!onDelete) return;
    const ok = window.confirm(
      `Delete label "${displayName}"?\n\nMessages will not be deleted — only this label will be removed from them.`
    );
    if (!ok) return;
    onDelete(labelId);
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
        <div className="max-h-[240px] overflow-y-auto py-1">
          {filtered.length === 0 && !showCreateFromSearch && (
            <p className="px-3 py-2 text-[12px] text-[#5f6368]">No matching labels.</p>
          )}
          {filtered.map((l) => {
            const checked = effectiveSelected.has(l.id);
            const accent = labelColorMap.get(l.id);
            const isEditing = editingId === l.id;

            if (isEditing) {
              return (
                <div key={l.id} className="flex items-center gap-1 px-2 py-1.5">
                  <input
                    ref={editInputRef}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void submitEdit(l.id);
                      if (e.key === "Escape") setEditingId(null);
                    }}
                    className="min-w-0 flex-1 rounded border border-[#dadce0] px-2 py-1 text-[13px] outline-none focus:border-[#0b57d0]"
                  />
                  <button
                    type="button"
                    onClick={() => void submitEdit(l.id)}
                    className="shrink-0 text-[12px] font-medium text-[#0b57d0]"
                  >
                    Save
                  </button>
                </div>
              );
            }

            return (
              <div
                key={l.id}
                className="group flex items-center gap-1 px-2 py-0.5 hover:bg-[#f1f3f4]"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5 pl-1 text-[13px]">
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
                  <span className="min-w-0 flex-1 truncate text-[#202124]">
                    {labelDisplayName(l)}
                  </span>
                </label>
                {onEdit ? (
                  <button
                    type="button"
                    title="Rename label"
                    onClick={() => {
                      setEditingId(l.id);
                      setEditName(l.name);
                    }}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] opacity-0 transition-opacity hover:bg-[#e8eaed] group-hover:opacity-100"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                  </button>
                ) : null}
                {onDelete ? (
                  <button
                    type="button"
                    title="Delete label"
                    onClick={() => void submitDelete(l.id, labelDisplayName(l))}
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[#5f6368] opacity-0 transition-opacity hover:bg-[#fce8e6] hover:text-[#c5221f] group-hover:opacity-100"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
        {showCreateFromSearch && (
          <div className="border-t border-[#e8eaed]">
            <button
              type="button"
              onClick={() => void submitCreate(query.trim())}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-[#0b57d0] hover:bg-[#f1f3f4]"
            >
              {`Create "${query.trim()}"`}
            </button>
          </div>
        )}
        <div className="border-t border-[#e8eaed]">
          {createMode ? (
            <div className="flex items-center gap-1 p-2">
              <input
                ref={createInputRef}
                value={newLabelName}
                onChange={(e) => setNewLabelName(e.target.value)}
                placeholder="New label name"
                onKeyDown={(e) => {
                  if (e.key === "Enter") void submitCreate(newLabelName);
                  if (e.key === "Escape") {
                    setCreateMode(false);
                    setNewLabelName("");
                  }
                }}
                className="min-w-0 flex-1 rounded border border-[#dadce0] px-2 py-1.5 text-[13px] outline-none focus:border-[#0b57d0]"
              />
              <button
                type="button"
                disabled={!newLabelName.trim()}
                onClick={() => void submitCreate(newLabelName)}
                className="shrink-0 text-[12px] font-medium text-[#0b57d0] disabled:opacity-40"
              >
                Add
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setCreateMode(true);
                setNewLabelName(query.trim());
              }}
              className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-[13px] text-[#0b57d0] hover:bg-[#f1f3f4]"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Create new label
            </button>
          )}
        </div>
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
