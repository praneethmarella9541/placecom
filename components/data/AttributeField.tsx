"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import type { AttributeDef, RecordRow } from "@/lib/data-model/types";
import { dataApi, type RecordsResponse } from "@/lib/data-model/client";
import { TypeIcon } from "@/components/data/typeIcons";

/**
 * One attribute's editor. The form holds each value as an "input" (a string, or a boolean for a
 * checkbox); toPayload turns it into what /api/data expects, and the server re-validates all of it.
 */

export type FieldInput = string | boolean;

const LIST_HINT: Partial<Record<AttributeDef["type"], string>> = {
  email: "One or more, separated by commas",
  phone: "One or more, separated by commas",
  domain: "One or more, separated by commas",
};

const isListLike = (a: AttributeDef) => a.is_multi || a.type === "multi_select";

export function toInput(attr: AttributeDef, stored: unknown): FieldInput {
  if (attr.type === "checkbox") return stored === true;
  if (stored === null || stored === undefined) return "";
  if (Array.isArray(stored)) return stored.join(", ");
  return String(stored);
}

export function toPayload(attr: AttributeDef, input: FieldInput): unknown {
  if (attr.type === "checkbox") return input === true ? true : null;
  const text = typeof input === "string" ? input.trim() : "";
  if (!text) return null;
  if (isListLike(attr)) return text.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  return text;
}

export function samePayload(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

type Member = { id: string; name: string };
let membersCache: Promise<Member[]> | null = null;

/** The team, fetched once per page load; a failed fetch is retried next time. */
function loadMembers(): Promise<Member[]> {
  if (!membersCache) {
    membersCache = dataApi<{ members: Member[] }>("/api/data/members").then((r) => {
      if (!r.ok) membersCache = null;
      return r.ok ? r.data.members : [];
    });
  }
  return membersCache;
}

function MemberSelect({ id, value, onChange, disabled }: { id: string; value: string; onChange: (v: string) => void; disabled?: boolean }) {
  const [members, setMembers] = useState<Member[]>([]);
  useEffect(() => {
    let live = true;
    void loadMembers().then((m) => live && setMembers(m));
    return () => {
      live = false;
    };
  }, []);
  return (
    <select id={id} disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className="input-field select-chevron h-9 text-[13px]">
      <option value="">Not assigned</option>
      {members.map((m) => (
        <option key={m.id} value={m.id}>{m.name}</option>
      ))}
    </select>
  );
}

/** Search-as-you-type picker for a record_ref attribute. Holds the chosen record's id. */
export function RecordPicker({
  targetObject,
  value,
  onChange,
  disabled,
  id,
  onChosen,
}: {
  targetObject: string;
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  id?: string;
  /** Also told which record was picked (null when cleared), for callers that show its name. */
  onChosen?: (record: RecordRow | null) => void;
}) {
  const [chosen, setChosen] = useState<RecordRow | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<RecordRow[]>([]);
  const box = useRef<HTMLDivElement>(null);

  // Show the name of whatever is already chosen.
  useEffect(() => {
    let live = true;
    if (!value) {
      setChosen(null);
      return;
    }
    void dataApi<{ record: RecordRow }>(`/api/data/records/${value}`).then((r) => {
      if (live && r.ok) setChosen(r.data.record);
    });
    return () => {
      live = false;
    };
  }, [value]);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(() => {
      void dataApi<RecordsResponse>(
        `/api/data/records?object=${encodeURIComponent(targetObject)}&q=${encodeURIComponent(q)}&sort=name&pageSize=8`
      ).then((r) => {
        if (live && r.ok) setOptions(r.data.records);
      });
    }, 180);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, q, targetObject]);

  useEffect(() => {
    function away(e: MouseEvent) {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, []);

  if (value && chosen && !open) {
    return (
      <div className="input-field flex h-9 items-center justify-between gap-2 text-[13px]">
        <span className="truncate">{chosen.name || "Unnamed"}</span>
        {!disabled && (
          <button type="button" aria-label="Clear" onClick={() => onChange("")} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div ref={box} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-text-faint)]" />
      <input
        id={id}
        type="search"
        disabled={disabled}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        placeholder={`Search ${targetObject}…`}
        className="input-field h-9 pl-8 text-[13px]"
      />
      {open && (
        <ul className="absolute z-30 mt-1 max-h-56 w-full overflow-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] py-1 shadow-[var(--shadow-lg)]">
          {options.length === 0 ? (
            <li className="px-3 py-2 text-[12.5px] text-[var(--color-text-faint)]">No matches</li>
          ) : (
            options.map((o) => (
              <li key={o.id}>
                <button
                  type="button"
                  className="block w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-[var(--color-surface-2)]"
                  onClick={() => {
                    setChosen(o);
                    setQ("");
                    setOpen(false);
                    onChosen?.(o);
                    onChange(o.id);
                  }}
                >
                  {o.name || "Unnamed"}
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

export function AttributeField({
  attr,
  value,
  onChange,
  onBlur,
  disabled,
  idPrefix = "attr",
  bare = false,
  commitOnChange = false,
}: {
  attr: AttributeDef;
  value: FieldInput;
  onChange: (v: FieldInput) => void;
  /** Called when the user leaves the field; the record page saves on this. */
  onBlur?: () => void;
  disabled?: boolean;
  /** Needed when several fields for the same attribute are on screen at once (cards on a board). */
  idPrefix?: string;
  /** No label above the control, for use inside a table cell. */
  bare?: boolean;
  /** Selects tell onBlur straight after a choice, so a cell saves the moment you pick. */
  commitOnChange?: boolean;
}) {
  const id = `${idPrefix}-${attr.slug}`;
  const common = { id, disabled, onBlur, className: "input-field h-9 text-[13px]" };

  let control: React.ReactNode;
  switch (attr.type) {
    case "checkbox":
      control = (
        <label className="flex h-9 items-center gap-2 text-[13px]">
          <input
            id={id}
            type="checkbox"
            disabled={disabled}
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked);
              onBlur?.();
            }}
          />
          Yes
        </label>
      );
      break;
    case "long_text":
      control = (
        <textarea
          id={id}
          disabled={disabled}
          rows={4}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          className="input-field text-[13px]"
        />
      );
      break;
    case "select":
    case "rating": {
      const options =
        attr.type === "rating"
          ? Array.from({ length: attr.config.max ?? 5 }, (_, i) => String(i + 1))
          : (attr.config.options ?? []);
      control = (
        <select
          {...common}
          className="input-field select-chevron h-9 text-[13px]"
          value={String(value)}
          onChange={(e) => {
            onChange(e.target.value);
            if (commitOnChange) setTimeout(() => onBlur?.(), 0);
          }}
          onBlur={onBlur}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {attr.type === "rating" ? "★".repeat(Number(o)) : o}
            </option>
          ))}
        </select>
      );
      break;
    }
    case "record_ref":
      control = (
        <RecordPicker
          id={id}
          targetObject={attr.config.target_object ?? "people"}
          value={String(value)}
          disabled={disabled}
          onChange={(v) => {
            onChange(v);
            // A picked reference is a finished choice; save it without waiting for a blur.
            setTimeout(() => onBlur?.(), 0);
          }}
        />
      );
      break;
    case "member":
      control = (
        <MemberSelect
          id={id}
          value={String(value)}
          disabled={disabled}
          onChange={(v) => {
            onChange(v);
            setTimeout(() => onBlur?.(), 0);
          }}
        />
      );
      break;
    default: {
      const type =
        attr.type === "number" || attr.type === "currency"
          ? "text"
          : attr.type === "date"
            ? "date"
            : attr.type === "url"
              ? "text"
              : "text";
      control = (
        <input
          {...common}
          type={type}
          inputMode={attr.type === "number" || attr.type === "currency" ? "decimal" : undefined}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={LIST_HINT[attr.type] && isListLike(attr) ? LIST_HINT[attr.type] : undefined}
        />
      );
    }
  }

  if (bare) return <div>{control}</div>;

  return (
    <div>
      <label htmlFor={id} className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">
        <TypeIcon type={attr.type} className="h-3 w-3" />
        {attr.name}
        {attr.is_required ? " *" : ""}
      </label>
      {control}
    </div>
  );
}
