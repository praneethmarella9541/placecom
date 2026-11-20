"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Condition, ConditionOp, FieldSet } from "@/lib/workflows/types";
import { CONDITION_OP_LABELS, type MetaObject, type VariableOption } from "@/lib/workflows/describe";

/** Small editors the block panels are made of. */

export const labelCls = "mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]";
export const inputCls = "input-field h-9 text-[13px]";
export const selectCls = "input-field select-chevron h-9 text-[13px]";

/** Text that can hold {{variables}}, with a menu to insert one. */
export function TemplateInput({ value, onChange, variables, placeholder, multiline, id, label }: { value: string; onChange: (v: string) => void; variables: VariableOption[]; placeholder?: string; multiline?: boolean; id?: string; label?: string }) {
  const [pick, setPick] = useState("");
  return (
    <div className="space-y-1">
      {multiline ? (
        <textarea id={id} rows={3} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="input-field !h-auto py-2 text-[13px]" />
      ) : (
        <input id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputCls} />
      )}
      {variables.length > 0 && (
        <select
          aria-label="Insert a variable"
          value={pick}
          onChange={(e) => {
            if (!e.target.value) return;
            onChange(`${value}{{${e.target.value}}}`);
            setPick("");
          }}
          className="input-field select-chevron h-7 w-auto max-w-full text-[12px]"
        >
          <option value="">Insert a variable…</option>
          {variables.map((v) => (
            <option key={v.path} value={v.path}>{v.label}</option>
          ))}
        </select>
      )}
    </div>
  );
}

export function ConditionsEditor({ match, conditions, onChange, variables }: { match: "all" | "any"; conditions: Condition[]; onChange: (match: "all" | "any", conditions: Condition[]) => void; variables: VariableOption[] }) {
  const set = (i: number, patch: Partial<Condition>) => onChange(match, conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  return (
    <div className="space-y-3">
      {conditions.length > 1 && (
        <div>
          <label className={labelCls} htmlFor="cond-match">Pass when</label>
          <select id="cond-match" value={match} onChange={(e) => onChange(e.target.value as "all" | "any", conditions)} className={selectCls}>
            <option value="all">All of these are true</option>
            <option value="any">Any of these is true</option>
          </select>
        </div>
      )}
      {conditions.map((c, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-[var(--color-border)] p-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]">Condition {i + 1}</span>
            <button type="button" aria-label={`Remove condition ${i + 1}`} onClick={() => onChange(match, conditions.filter((_, j) => j !== i))} className="text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"><X className="h-3.5 w-3.5" /></button>
          </div>
          <TemplateInput label="Value to check" value={c.left} onChange={(v) => set(i, { left: v })} variables={variables} placeholder="{{trigger.record.values.status}}" />
          <select aria-label="Condition" value={c.op} onChange={(e) => set(i, { op: e.target.value as ConditionOp })} className={selectCls}>
            {(Object.keys(CONDITION_OP_LABELS) as ConditionOp[]).map((o) => (
              <option key={o} value={o}>{CONDITION_OP_LABELS[o]}</option>
            ))}
          </select>
          {c.op !== "empty" && c.op !== "not_empty" && <TemplateInput label="Compare with" value={c.right ?? ""} onChange={(v) => set(i, { right: v })} variables={variables} placeholder="Won" />}
        </div>
      ))}
      {conditions.length < 10 && (
        <button type="button" onClick={() => onChange(match, [...conditions, { left: "", op: "eq", right: "" }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <Plus className="h-3.5 w-3.5" /> Add a condition
        </button>
      )}
    </div>
  );
}

export function FieldsEditor({ object, fields, onChange, variables }: { object: MetaObject | undefined; fields: FieldSet[]; onChange: (f: FieldSet[]) => void; variables: VariableOption[] }) {
  const set = (i: number, patch: Partial<FieldSet>) => onChange(fields.map((f, j) => (j === i ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="space-y-1.5 rounded-lg border border-[var(--color-border)] p-2.5">
          <div className="flex items-center gap-2">
            <select aria-label={`Field ${i + 1}`} value={f.attribute} onChange={(e) => set(i, { attribute: e.target.value })} className={`${selectCls} flex-1`}>
              <option value="name">Name</option>
              {(object?.attributes ?? []).map((a) => (
                <option key={a.slug} value={a.slug}>{a.name}</option>
              ))}
            </select>
            <button type="button" aria-label={`Remove field ${i + 1}`} onClick={() => onChange(fields.filter((_, j) => j !== i))} className="text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"><X className="h-3.5 w-3.5" /></button>
          </div>
          <TemplateInput label={`Value for field ${i + 1}`} value={f.value} onChange={(v) => set(i, { value: v })} variables={variables} placeholder="Leave empty to clear the field" />
        </div>
      ))}
      {fields.length < 20 && (
        <button type="button" onClick={() => onChange([...fields, { attribute: "name", value: "" }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <Plus className="h-3.5 w-3.5" /> Set a field
        </button>
      )}
    </div>
  );
}
