"use client";

import { useEffect, useState } from "react";
import { Tag } from "lucide-react";
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
  const accent = accentProp ?? labelAccentStyle(label);

  useEffect(() => {
    if (!editing) setEditName(label.name);
  }, [label.name, editing]);

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

  function confirmDelete(e: React.MouseEvent) {
    e.stopPropagation();
    const ok = window.confirm(
      `Delete label "${label.name}"?\n\nMessages will not be deleted — only this label will be removed from them.`
    );
    if (ok) onDelete(label.id);
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
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex w-full items-center gap-2.5 rounded-r-full py-[7px] pl-2 pr-1 text-[13px] transition-colors",
        active
          ? "bg-[var(--color-primary-light)] font-semibold text-[var(--gmail-nav-active-text)] shadow-[inset_3px_0_0_0_var(--label-accent)]"
          : "font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-offset)]"
      )}
      style={active ? ({ "--label-accent": accent.accent } as React.CSSProperties) : undefined}
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
          "min-w-0 flex-1 truncate text-left",
          !active && "group-hover:text-[var(--color-text)]"
        )}
      >
        {label.name}
      </span>
      {unread > 0 ? (
        <span
          className={cn(
            "mr-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums",
            active
              ? "bg-[var(--color-surface)]/80 text-[var(--gmail-nav-active-text)]"
              : "bg-[var(--color-surface-offset)] text-[var(--color-text-muted)] group-hover:bg-[var(--color-surface)]"
          )}
        >
          {unread > 999 ? "999+" : unread}
        </span>
      ) : null}
      <span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100">
        <span
          role="button"
          tabIndex={0}
          title="Rename label"
          onClick={(e) => {
            e.stopPropagation();
            setEditName(label.name);
            setEditing(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              setEditName(label.name);
              setEditing(true);
            }
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-faint)] hover:bg-[var(--color-surface-offset)] hover:text-[var(--color-text)]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </span>
        <span
          role="button"
          tabIndex={0}
          title="Delete label"
          onClick={confirmDelete}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              confirmDelete(e as unknown as React.MouseEvent);
            }
          }}
          className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--color-text-faint)] hover:bg-[#fce8e6] hover:text-[#c5221f]"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </span>
      </span>
    </button>
  );
}
