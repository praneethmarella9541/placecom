"use client";

import { useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { BLOCK_LABELS } from "@/lib/workflows/graph";
import type { Block, Condition, FieldSet, Graph, Trigger, TriggerType } from "@/lib/workflows/types";
import { TRIGGER_TYPES } from "@/lib/workflows/types";
import { TRIGGER_LABELS, blockTitle, variablesFor, type VariableOption, type WorkflowMeta } from "@/lib/workflows/describe";
import { buildStaticFormulaSchema, compileConditionFormula, variablePathToSlug } from "@/lib/workflows/condition-formula";
import { ConditionsEditor, FieldsEditor, TemplateInput, inputCls, labelCls, selectCls } from "@/components/workflows/fields";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function Field({ label, htmlFor, children, hint }: { label: string; htmlFor?: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label htmlFor={htmlFor} className={labelCls}>{label}</label>
      {children}
      {hint && <p className="mt-1 text-[12px] text-[var(--color-text-faint)]">{hint}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trigger
// ---------------------------------------------------------------------------

export function TriggerPanel({ trigger, meta, onChange }: { trigger: Trigger; meta: WorkflowMeta | null; onChange: (t: Trigger) => void }) {
  const c = trigger.config;
  const set = (patch: Record<string, unknown>) => onChange({ ...trigger, config: { ...c, ...patch } });
  const obj = meta?.objects.find((o) => o.slug === c.object);
  const list = meta?.lists.find((l) => l.id === c.list);

  const objectSelect = (
    <Field label="Object" htmlFor="trg-object">
      <select id="trg-object" value={String(c.object ?? "")} onChange={(e) => set({ object: e.target.value, attribute: undefined, attributes: [] })} className={selectCls}>
        <option value="">Choose…</option>
        {(meta?.objects ?? []).map((o) => (
          <option key={o.slug} value={o.slug}>{o.plural_name}</option>
        ))}
      </select>
    </Field>
  );

  return (
    <div className="space-y-4">
      <Field label="Starts when" htmlFor="trg-type" hint="A workflow has exactly one trigger.">
        <select id="trg-type" value={trigger.type ?? ""} onChange={(e) => onChange({ type: (e.target.value || null) as TriggerType | null, config: e.target.value === "schedule" ? { every: "day", at: "09:00", weekday: 1, tz: "Asia/Kolkata" } : {} })} className={selectCls}>
          <option value="">Choose…</option>
          {TRIGGER_TYPES.map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
          ))}
        </select>
      </Field>

      {(trigger.type === "record_created" || trigger.type === "manual") && objectSelect}

      {trigger.type === "record_updated" && (
        <>
          {objectSelect}
          {obj && (
            <fieldset>
              <legend className={labelCls}>Only when one of these changes (none = any)</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {["name", ...obj.attributes.map((a) => a.slug)].map((slug) => {
                  const picked = ((c.attributes as string[] | undefined) ?? []).includes(slug);
                  const label = slug === "name" ? "Name" : (obj.attributes.find((a) => a.slug === slug)?.name ?? slug);
                  return (
                    <label key={slug} className="flex items-center gap-2 text-[13px]">
                      <input type="checkbox" checked={picked} onChange={() => set({ attributes: picked ? ((c.attributes as string[]) ?? []).filter((x) => x !== slug) : [...((c.attributes as string[]) ?? []), slug] })} />
                      {label}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
        </>
      )}

      {trigger.type === "attribute_changed" && (
        <>
          {objectSelect}
          <Field label="Field" htmlFor="trg-attr">
            <select id="trg-attr" value={String(c.attribute ?? "")} onChange={(e) => set({ attribute: e.target.value })} className={selectCls}>
              <option value="">Choose…</option>
              <option value="name">Name</option>
              {(obj?.attributes ?? []).map((a) => (
                <option key={a.slug} value={a.slug}>{a.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Changes from (optional)" htmlFor="trg-from"><input id="trg-from" value={String(c.from ?? "")} onChange={(e) => set({ from: e.target.value || undefined })} className={inputCls} /></Field>
          <Field label="Changes to (optional)" htmlFor="trg-to"><input id="trg-to" value={String(c.to ?? "")} onChange={(e) => set({ to: e.target.value || undefined })} className={inputCls} placeholder="Won" /></Field>
        </>
      )}

      {(trigger.type === "list_added" || trigger.type === "list_entry_updated") && (
        <Field label="List" htmlFor="trg-list">
          <select id="trg-list" value={String(c.list ?? "")} onChange={(e) => set({ list: e.target.value, to: undefined })} className={selectCls}>
            <option value="">Choose…</option>
            {(meta?.lists ?? []).map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </Field>
      )}

      {trigger.type === "list_entry_updated" && (
        <>
          <Field label="What changes" htmlFor="trg-what">
            <select id="trg-what" value={String(c.attribute ?? "")} onChange={(e) => set({ attribute: e.target.value || undefined, to: undefined })} className={selectCls}>
              <option value="">Anything on the entry</option>
              <option value="stage">The stage</option>
            </select>
          </Field>
          {c.attribute === "stage" && list && (
            <Field label="Moves into (optional)" htmlFor="trg-stage">
              <select id="trg-stage" value={String(c.to ?? "")} onChange={(e) => set({ to: e.target.value || undefined })} className={selectCls}>
                <option value="">Any stage</option>
                {list.stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
          )}
        </>
      )}

      {trigger.type === "rule_matched" && (
        <>
          {objectSelect}
          <Field label="Rule API name (optional)" htmlFor="trg-rule-api-name" hint='Leave blank to match any rule on this object. Set on a formula rule — "Add rule" in its object, Formula tab.'>
            <input id="trg-rule-api-name" value={String(c.apiName ?? "")} onChange={(e) => set({ apiName: e.target.value || undefined })} className={inputCls} placeholder="package_value_minimum" />
          </Field>
          <Field label="Outcome" htmlFor="trg-rule-outcome">
            <select id="trg-rule-outcome" value={String(c.outcome ?? "any")} onChange={(e) => set({ outcome: e.target.value })} className={selectCls}>
              <option value="any">Any (blocked, warned or bypassed)</option>
              <option value="blocked">Blocks the save</option>
              <option value="warned">Warns, but the save goes through</option>
              <option value="bypassed">Is bypassed by an admin</option>
            </select>
          </Field>
          <p className="text-[12px] text-[var(--color-text-faint)]">A rule that blocked a new record has no record to work on — only an update, a stage move, or a warn/bypass does.</p>
        </>
      )}

      {trigger.type === "schedule" && (
        <>
          <Field label="Every" htmlFor="trg-every">
            <select id="trg-every" value={String(c.every ?? "day")} onChange={(e) => set({ every: e.target.value })} className={selectCls}>
              <option value="hour">Hour</option>
              <option value="day">Day</option>
              <option value="week">Week</option>
            </select>
          </Field>
          {c.every !== "hour" && (
            <Field label="At" htmlFor="trg-at"><input id="trg-at" type="time" value={String(c.at ?? "09:00")} onChange={(e) => set({ at: e.target.value })} className={inputCls} /></Field>
          )}
          {c.every === "week" && (
            <Field label="On" htmlFor="trg-weekday">
              <select id="trg-weekday" value={String(c.weekday ?? 1)} onChange={(e) => set({ weekday: Number(e.target.value) })} className={selectCls}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>{d}</option>
                ))}
              </select>
            </Field>
          )}
          <Field label="Time zone" htmlFor="trg-tz" hint="For example Asia/Kolkata."><input id="trg-tz" value={String(c.tz ?? "Asia/Kolkata")} onChange={(e) => set({ tz: e.target.value })} className={inputCls} /></Field>
          <p className="text-[12px] text-[var(--color-text-faint)]">A scheduled run has no record. Use a &ldquo;Find records&rdquo; block to fetch the ones to work on.</p>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/**
 * A condition as a formula (lib/workflows/condition-formula.ts) instead of the plain field/op/value
 * list — the same engine validation rules use. A variable like trigger.record.values.score is
 * offered under its flat slug (trigger_record_values_score); the real check happens when the
 * workflow runs, against that run's actual data, so this compile check is a best-effort hint, not a
 * guarantee (a path only this run's data happens to be missing still runs fine at run time).
 */
function ConditionFormulaEditor({ formula, variables, onChange }: { formula: string; variables: VariableOption[]; onChange: (formula: string) => void }) {
  const schema = useMemo(() => buildStaticFormulaSchema(variables), [variables]);
  const error = useMemo(() => {
    if (!formula.trim()) return null;
    const compiled = compileConditionFormula(formula, schema);
    return compiled.ok ? null : compiled.error;
  }, [formula, schema]);

  return (
    <div className="space-y-2">
      <Field label="Formula — TRUE means the condition is met" htmlFor="blk-cond-formula">
        <textarea id="blk-cond-formula" value={formula} onChange={(e) => onChange(e.target.value)} rows={3} maxLength={4000} placeholder="trigger_record_values_score > 90" className="input-field w-full resize-y font-mono text-[12.5px]" />
      </Field>
      {error && <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-2 py-1.5 text-[12px] text-[var(--color-danger)]">{error}</p>}
      {variables.length > 0 && (
        <details className="text-[12px] text-[var(--color-text-faint)]">
          <summary className="cursor-pointer select-none">Available fields</summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {variables.map((v) => <li key={v.path}>{variablePathToSlug(v.path)} <span className="text-[var(--color-text-faint)]">— {v.label}</span></li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Which object a record reference points at, so the field pickers can offer that object's fields. */
function objectForRecordRef(template: string, graph: Graph, trigger: Trigger): string | undefined {
  if (/^\{\{\s*trigger\.record\.id\s*\}\}$/.test(template)) return trigger.config.object as string | undefined;
  const m = template.match(/^\{\{\s*(b[0-9a-z]+)\.record\.id\s*\}\}$/);
  const src = m ? graph.blocks[m[1]] : undefined;
  return src && (src.type === "create_record" || src.type === "find_records") ? (src.config.object as string | undefined) : undefined;
}

export function BlockPanel({ block, graph, trigger, meta, onConfig, onLabel, onRemove }: { block: Block; graph: Graph; trigger: Trigger; meta: WorkflowMeta | null; onConfig: (config: Record<string, unknown>) => void; onLabel: (label: string) => void; onRemove: () => void }) {
  const c = block.config;
  const set = (patch: Record<string, unknown>) => onConfig({ ...c, ...patch });
  const vars = variablesFor(graph, block.key, trigger, meta);
  const members = meta?.members ?? [];

  const recordField = (
    <Field label="Record" htmlFor="blk-record" hint="Usually the record that started the workflow.">
      <TemplateInput id="blk-record" label="Record" value={String(c.record ?? "")} onChange={(v) => set({ record: v })} variables={vars.filter((v) => v.path.endsWith(".id"))} placeholder="{{trigger.record.id}}" />
    </Field>
  );

  let body: React.ReactNode = null;
  switch (block.type) {
    case "filter":
    case "if_else": {
      const isFormula = c.conditionFormat === "formula";
      body = (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[12.5px] text-[var(--color-text-muted)]">{block.type === "filter" ? "If the conditions aren't met, the run ends here (not a failure)." : "Splits the path: Yes when the conditions are met, No otherwise."}</p>
            <div className="flex shrink-0 gap-1 rounded-lg border border-[var(--color-border)] p-0.5 text-[11.5px] font-semibold">
              <button type="button" onClick={() => set({ conditionFormat: "simple" })} className={`rounded-md px-2 py-0.5 ${!isFormula ? "bg-[var(--color-surface-alt)]" : "text-[var(--color-text-faint)]"}`}>Simple</button>
              <button type="button" onClick={() => set({ conditionFormat: "formula" })} className={`rounded-md px-2 py-0.5 ${isFormula ? "bg-[var(--color-surface-alt)]" : "text-[var(--color-text-faint)]"}`}>Formula</button>
            </div>
          </div>
          {isFormula ? (
            <ConditionFormulaEditor formula={String(c.formula ?? "")} variables={vars} onChange={(formula) => set({ formula })} />
          ) : (
            <ConditionsEditor match={c.match === "any" ? "any" : "all"} conditions={(c.conditions as Condition[]) ?? []} variables={vars} onChange={(match, conditions) => set({ match, conditions })} />
          )}
        </>
      );
      break;
    }
    case "delay":
      body = (
        <div className="flex gap-2">
          <Field label="Wait" htmlFor="blk-amount"><input id="blk-amount" type="number" min={1} value={String(c.amount ?? 1)} onChange={(e) => set({ amount: Number(e.target.value) })} className={`${inputCls} w-[100px]`} /></Field>
          <Field label="Unit" htmlFor="blk-unit">
            <select id="blk-unit" value={String(c.unit ?? "days")} onChange={(e) => set({ unit: e.target.value })} className={selectCls}>
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
            </select>
          </Field>
        </div>
      );
      break;
    case "update_record":
      body = (
        <>
          {recordField}
          <div>
            <p className={labelCls}>Set these fields</p>
            <FieldsEditor object={meta?.objects.find((o) => o.slug === objectForRecordRef(String(c.record ?? ""), graph, trigger))} fields={(c.fields as FieldSet[]) ?? []} variables={vars} onChange={(fields) => set({ fields })} />
          </div>
        </>
      );
      break;
    case "create_record": {
      const obj = meta?.objects.find((o) => o.slug === c.object);
      body = (
        <>
          <Field label="Kind of record" htmlFor="blk-object">
            <select id="blk-object" value={String(c.object ?? "")} onChange={(e) => set({ object: e.target.value, fields: [] })} className={selectCls}>
              <option value="">Choose…</option>
              {(meta?.objects ?? []).map((o) => (
                <option key={o.slug} value={o.slug}>{o.singular_name}</option>
              ))}
            </select>
          </Field>
          <Field label="Name" htmlFor="blk-name"><TemplateInput id="blk-name" label="Name" value={String(c.name ?? "")} onChange={(v) => set({ name: v })} variables={vars} /></Field>
          <div>
            <p className={labelCls}>Set these fields</p>
            <FieldsEditor object={obj} fields={(c.fields as FieldSet[]) ?? []} variables={vars} onChange={(fields) => set({ fields })} />
          </div>
          <p className="text-[12px] text-[var(--color-text-faint)]">If its email or domain already belongs to a record, that record is used instead of making a duplicate.</p>
        </>
      );
      break;
    }
    case "find_records": {
      const obj = meta?.objects.find((o) => o.slug === c.object);
      const conds = (c.conditions as { attribute: string; op: string; value: string }[]) ?? [];
      const setCond = (i: number, patch: Partial<{ attribute: string; op: string; value: string }>) => set({ conditions: conds.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
      body = (
        <>
          <Field label="Look for" htmlFor="blk-object">
            <select id="blk-object" value={String(c.object ?? "")} onChange={(e) => set({ object: e.target.value, conditions: [{ attribute: "name", op: "contains", value: "" }] })} className={selectCls}>
              <option value="">Choose…</option>
              {(meta?.objects ?? []).map((o) => (
                <option key={o.slug} value={o.slug}>{o.plural_name}</option>
              ))}
            </select>
          </Field>
          {conds.map((k, i) => (
            <div key={i} className="space-y-1.5 rounded-lg border border-[var(--color-border)] p-2.5">
              <select aria-label={`Field ${i + 1}`} value={k.attribute} onChange={(e) => setCond(i, { attribute: e.target.value })} className={selectCls}>
                <option value="name">Name</option>
                {(obj?.attributes ?? []).map((a) => (
                  <option key={a.slug} value={a.slug}>{a.name}</option>
                ))}
              </select>
              <select aria-label={`Condition ${i + 1}`} value={k.op} onChange={(e) => setCond(i, { op: e.target.value })} className={selectCls}>
                <option value="contains">contains</option>
                <option value="eq">is</option>
                <option value="neq">is not</option>
                <option value="not_empty">is not empty</option>
                <option value="empty">is empty</option>
              </select>
              {k.op !== "empty" && k.op !== "not_empty" && <TemplateInput label={`Value ${i + 1}`} value={k.value} onChange={(v) => setCond(i, { value: v })} variables={vars} />}
              {conds.length > 1 && <button type="button" onClick={() => set({ conditions: conds.filter((_, j) => j !== i) })} className="text-[12px] text-[var(--color-text-faint)] underline">Remove</button>}
            </div>
          ))}
          {conds.length < 5 && <button type="button" onClick={() => set({ conditions: [...conds, { attribute: "name", op: "contains", value: "" }] })} className="text-[12.5px] font-semibold text-[var(--color-text-muted)] underline">Add a condition</button>}
          <p className="text-[12px] text-[var(--color-text-faint)]">Gives the first match to later blocks as <code>{`{{${block.key}.record.id}}`}</code>, and how many were found as <code>{`{{${block.key}.found}}`}</code>.</p>
        </>
      );
      break;
    }
    case "add_to_list":
    case "update_list_entry": {
      const list = meta?.lists.find((l) => l.id === c.list);
      body = (
        <>
          <Field label="List" htmlFor="blk-list">
            <select id="blk-list" value={String(c.list ?? "")} onChange={(e) => set({ list: e.target.value, stage: "" })} className={selectCls}>
              <option value="">Choose…</option>
              {(meta?.lists ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </Field>
          {recordField}
          {list?.has_stages && (
            <Field label={block.type === "add_to_list" ? "Start in stage" : "Move to stage"} htmlFor="blk-stage" hint={block.type === "add_to_list" ? "Empty = the first stage." : "Empty = leave the stage as it is."}>
              <select id="blk-stage" value={String(c.stage ?? "")} onChange={(e) => set({ stage: e.target.value })} className={selectCls}>
                <option value="">{block.type === "add_to_list" ? "First stage" : "Don't move"}</option>
                {list.stages.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
          )}
        </>
      );
      break;
    }
    case "create_note":
      body = (
        <>
          {recordField}
          <Field label="Type" htmlFor="blk-kind">
            <select id="blk-kind" value={String(c.kind ?? "note")} onChange={(e) => set({ kind: e.target.value })} className={selectCls}>
              <option value="note">Note</option>
              <option value="call">Call</option>
              <option value="email">Email</option>
              <option value="meeting">Meeting</option>
            </select>
          </Field>
          <Field label="Text" htmlFor="blk-body"><TemplateInput id="blk-body" label="Text" multiline value={String(c.body ?? "")} onChange={(v) => set({ body: v })} variables={vars} /></Field>
        </>
      );
      break;
    case "create_task":
      body = (
        <>
          {recordField}
          <Field label="Title" htmlFor="blk-title"><TemplateInput id="blk-title" label="Title" value={String(c.title ?? "")} onChange={(v) => set({ title: v })} variables={vars} /></Field>
          <Field label="Due in (days, empty = no date)" htmlFor="blk-due"><input id="blk-due" type="number" min={0} value={c.dueInDays === null || c.dueInDays === undefined ? "" : String(c.dueInDays)} onChange={(e) => set({ dueInDays: e.target.value === "" ? null : Number(e.target.value) })} className={`${inputCls} w-[120px]`} /></Field>
          <Field label="Assign to" htmlFor="blk-assignee">
            <select id="blk-assignee" value={String(c.assignee ?? "owner")} onChange={(e) => set({ assignee: e.target.value })} className={selectCls}>
              <option value="owner">The workflow&apos;s owner</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
        </>
      );
      break;
    case "send_notification":
      body = (
        <>
          <Field label="Notify" htmlFor="blk-to">
            <select id="blk-to" value={String(c.to ?? "owner")} onChange={(e) => set({ to: e.target.value })} className={selectCls}>
              <option value="owner">The workflow&apos;s owner</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Title" htmlFor="blk-ntitle"><TemplateInput id="blk-ntitle" label="Title" value={String(c.title ?? "")} onChange={(v) => set({ title: v })} variables={vars} /></Field>
          <Field label="Message" htmlFor="blk-nbody"><TemplateInput id="blk-nbody" label="Message" multiline value={String(c.body ?? "")} onChange={(v) => set({ body: v })} variables={vars} /></Field>
          <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={c.linkToRecord !== false} onChange={(e) => set({ linkToRecord: e.target.checked })} /> Link to the trigger record</label>
        </>
      );
      break;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[14px] font-semibold">{BLOCK_LABELS[block.type]}</h3>
          <p className="font-mono text-[11px] text-[var(--color-text-faint)]">{block.key}</p>
        </div>
        <button type="button" onClick={onRemove} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--color-danger)] hover:underline"><Trash2 className="h-3.5 w-3.5" /> Remove</button>
      </div>
      <Field label="Name on the canvas (optional)" htmlFor="blk-label"><input id="blk-label" value={block.label ?? ""} maxLength={60} placeholder={blockTitle({ ...block, label: undefined })} onChange={(e) => onLabel(e.target.value)} className={inputCls} /></Field>
      {body}
    </div>
  );
}
