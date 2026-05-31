"use client";

import { useEffect, useRef, useState } from "react";
import { MoreVertical, Tag } from "lucide-react";
import { labelAccentStyle, type LabelLike } from "@/components/LabelChip";
import { cn } from "@/lib/utils";

type Props = {
  label: LabelLike & { id: string; name: string };
  active: boolean;
  unread: number;
  accent?: ReturnType<typeof labelAccentStyle>;
  onSelect: () => void;
  onEdit: (labelId: string, newName: string) => void;
  onDelete: (labelId: string) => void;
};

export function LabelSidebarItem({
  label,
  active,
  unread,
  accent: accentProp,
  onSelect,
  onEdit,
  onDelete,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(label.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const accent = accentProp ?? labelAccentStyle(label);

  useEffect(() => {
    if (!editing) setEditName(label.name);
  }, [label.name, editing]);

  useEffect(() => {
    if (!menuOpen) return;
    function onDoc(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [menuOpen]);

  function saveEdit() {
    const trimmed = editName.trim();
    if (!trimmed || trimmed === label.name) {
      setEditing(false);
      setEditName(label.name);
      return;
    }
    setEditing(false);
    onEdit(label.id, trimmed);
  }

  function handleDelete() {
    setMenuOpen(false);
    onDelete(label.id);
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-r-full py-1 pl-2 pr-2">
        <input
          autoFocus
          value={editName}
          onChange={(e) => setEditName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEdit();
            if (e.key === "Escape") {
              setEditing(false);
              setEditName(label.name);
            }
          }}
          onBlur={saveEdit}
          className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-[12px] outline-none focus:border-[var(--color-primary)]"
        />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "group relative flex w-full items-center rounded-r-full py-[7px] pl-2 pr-1 text-[13px] transition-colors",
        active
          ? "bg-[var(--color-primary-light)] font-semibold text-[var(--gmail-nav-active-text)] shadow-[inset_3px_0_0_0_var(--label-accent)]"
          : "font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
      )}
      style={active ? ({ "--label-accent": accent.accent } as React.CSSProperties) : undefined}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2.5 pr-1 text-left"
      >
        <span
          className={cn(
            "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-colors",
            active ? "border-white/60" : "border-transparent"
          )}
          style={{ backgroundColor: accent.bg }}
        >
          <Tag className="h-3.5 w-3.5" style={{ color: accent.accent }} strokeWidth={2.25} aria-hidden />
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            !active && "group-hover:text-[var(--color-text)]"
          )}
        >
          {label.name}
        </span>
        {unread > 0 ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
              active
                ? "text-[var(--gmail-nav-active-text)]"
                : "text-[var(--color-text-faint)] group-hover:text-[var(--color-text-muted)]"
            )}
          >
            {unread > 999 ? "999+" : unread}
          </span>
        ) : null}
      </button>

      <div ref={menuRef} className="relative shrink-0">
        <button
          type="button"
          aria-label="Label options"
          aria-expanded={menuOpen}
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-faint)] transition-opacity hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]",
            menuOpen ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          )}
        >
          <MoreVertical className="h-4 w-4" strokeWidth={2} />
        </button>
        {menuOpen ? (
          <div className="absolute right-0 top-full z-50 mt-0.5 min-w-[140px] overflow-hidden rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-lg">
            <button
              type="button"
              className="flex w-full px-3 py-2 text-left text-[13px] text-[var(--color-text)] hover:bg-[var(--color-surface-offset)]"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen(false);
                setEditName(label.name);
                setEditing(true);
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="flex w-full px-3 py-2 text-left text-[13px] text-[#c5221f] hover:bg-[#fce8e6]"
              onClick={(e) => {
                e.stopPropagation();
                handleDelete();
              }}
            >
              Delete
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
