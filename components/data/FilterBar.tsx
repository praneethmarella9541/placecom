"use client";

import { useState } from "react";
import { Filter, X } from "lucide-react";
import type { AttributeDef, FilterOp, RecordFilter } from "@/lib/data-model/types";

const OP_LABELS: Record<FilterOp, string> = {
  contains: "contains",
  eq: "is",
  neq: "is not",
  before: "is before",
  after: "is after",
  empty: "is empty",
  not_empty: "is not empty",
};

function opsFor(attr: AttributeDef): FilterOp[] {
  // References are ids, so only "has one or not" makes sense. Team members can also be matched on a person.
  if (attr.type === "record_ref") return ["not_empty", "empty"];
  if (attr.type === "member") return ["eq", "neq", "not_empty", "empty"];
  if (attr.type === "date" || attr.type === "timestamp") return ["before", "after", "eq", "not_empty", "empty"];
  if (attr.type === "checkbox" || attr.type === "select" || attr.type === "multi_select" || attr.type === "rating") return ["eq", "neq", "not_empty", "empty"];
  return ["contains", "eq", "neq", "not_empty", "empty"];
}

type Member = { id: string; name: string };

const needsValue = (op: FilterOp) => op !== "empty" && op !== "not_empty";

/** What the value box is for this field: a date picker, the field's own options, a team list, or free text. */
function ValueInput({ attr, value, onChange, members, userId }: { attr: AttributeDef; value: string; onChange: (v: string) => void; members: Member[]; userId?: string }) {
  const cls = "input-field h-8 w-[170px] text-[12.5px]";
  if (attr.type === "date" || attr.type === "timestamp") return <input aria-label="Value" type="date" value={value} onChange={(e) => onChange(e.target.value)} className={cls} />;
  if (attr.type === "checkbox") {
    return (
      <select aria-label="Value" value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} select-chevron`}>
        <option value="">Choose…</option>
        <option value="true">Checked</option>
        <option value="false">Not checked</option>
      </select>
    );
  }
  if (attr.type === "select" || attr.type === "multi_select" || attr.type === "rating") {
    const options = attr.type === "rating" ? Array.from({ length: attr.config.max ?? 5 }, (_, i) => String(i + 1)) : (attr.config.options ?? []);
    return (
      <select aria-label="Value" value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} select-chevron`}>
        <option value="">Choose…</option>
        {options.map((o) => (
          <option key={o} value={o}>{attr.type === "rating" ? "★".repeat(Number(o)) : o}</option>
        ))}
      </select>
    );
  }
  if (attr.type === "member") {
    return (
      <select aria-label="Value" value={value} onChange={(e) => onChange(e.target.value)} className={`${cls} select-chevron`}>
        <option value="">Choose…</option>
        {userId && <option value={userId}>Me (current user)</option>}
        {members.filter((m) => m.id !== userId).map((m) => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    );
  }
  return <input aria-label="Value" autoFocus value={value} onChange={(e) => onChange(e.target.value)} className={cls} />;
}

export function FilterBar({
  attributes,
  filters,
  onChange,
  members = [],
  userId,
}: {
  attributes: AttributeDef[];
  filters: RecordFilter[];
  onChange: (f: RecordFilter[]) => void;
  members?: Member[];
  userId?: string;
}) {
  const [adding, setAdding] = useState(false);
  const [slug, setSlug] = useState(attributes[0]?.slug ?? "");
  const attr = attributes.find((a) => a.slug === slug) ?? attributes[0];
  const ops = attr ? opsFor(attr) : [];
  const [op, setOp] = useState<FilterOp>("contains");
  const [value, setValue] = useState("");
  const activeOp = ops.includes(op) ? op : ops[0];

  function add() {
    if (!attr || !activeOp) return;
    if (needsValue(activeOp) && !value.trim()) return;
    onChange([...filters, { attribute: attr.slug, op: activeOp, value: needsValue(activeOp) ? value.trim() : undefined }]);
    setValue("");
    setAdding(false);
  }

  const shown = (a: AttributeDef | undefined, v: string) => {
    if (a?.type === "member") return v === userId ? "me" : (members.find((m) => m.id === v)?.name ?? "a teammate");
    if (a?.type === "checkbox") return v === "true" ? "checked" : "not checked";
    return v;
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f, i) => {
        const a = attributes.find((x) => x.slug === f.attribute);
        return (
          <span key={`${f.attribute}-${i}`} className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] py-1 pl-3 pr-1.5 text-[12.5px]">
            {a?.name ?? f.attribute} {OP_LABELS[f.op]}{f.value ? ` "${shown(a, f.value)}"` : ""}
            <button type="button" aria-label="Remove filter" onClick={() => onChange(filters.filter((_, j) => j !== i))} className="rounded-full p-0.5 text-[var(--color-text-faint)] hover:text-[var(--color-text)]">
              <X className="h-3 w-3" />
            </button>
          </span>
        );
      })}
      {adding ? (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <select
            aria-label="Field"
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setValue("");
            }}
            className="input-field select-chevron h-8 text-[12.5px]"
          >
            {attributes.map((a) => (
              <option key={a.slug} value={a.slug}>{a.name}</option>
            ))}
          </select>
          <select aria-label="Condition" value={activeOp} onChange={(e) => setOp(e.target.value as FilterOp)} className="input-field select-chevron h-8 text-[12.5px]">
            {ops.map((o) => (
              <option key={o} value={o}>{OP_LABELS[o]}</option>
            ))}
          </select>
          {attr && activeOp && needsValue(activeOp) && <ValueInput attr={attr} value={value} onChange={setValue} members={members} userId={userId} />}
          <button type="submit" className="btn-primary-copper h-8 px-3 text-[12.5px]">Apply</button>
          <button type="button" onClick={() => setAdding(false)} className="btn-ghost h-8 px-2 text-[12.5px]">Cancel</button>
        </form>
      ) : (
        <button type="button" onClick={() => setAdding(true)} disabled={!attributes.length} className="btn-ghost inline-flex h-8 items-center gap-1.5 px-2.5 text-[12.5px]">
          <Filter className="h-3.5 w-3.5" /> Filter
        </button>
      )}
    </div>
  );
}
