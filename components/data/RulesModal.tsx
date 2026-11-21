"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Plus, X } from "lucide-react";
import type { AttributeDef } from "@/lib/data-model/types";
import type { RuleCondition, RuleOp, RuleRequirement } from "@/lib/data-model/rules";
import { dataApi } from "@/lib/data-model/client";

type StoredRule = { id: string; kind: "record" | "stage"; name: string; condition: RuleCondition; requirements: RuleRequirement[]; active: boolean; stage_id: string | null };
type Stage = { id: string; name: string };

type Props = { attributes: AttributeDef[]; onClose: () => void } & (
  | { mode: "record"; objectSlug: string; title: string }
  | { mode: "stage"; listId: string; stages: Stage[]; title: string }
);

const OP_LABELS: Record<RuleOp, string> = { eq: "is", neq: "is not", empty: "is empty", not_empty: "is not empty" };

/**
 * Admin: rules of the form "when X, Y is required". A record rule is checked whenever a record is
 * saved; a stage rule when a card moves into a stage. Existing records are not flagged: a rule is
 * only checked the next time a record is saved.
 */
export function RulesModal(props: Props) {
  const { attributes, onClose } = props;
  const fields = attributes.filter((a) => !a.archived_at);
  const [rules, setRules] = useState<StoredRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [useCondition, setUseCondition] = useState(false);
  const [condField, setCondField] = useState(fields[0]?.slug ?? "");
  const [condOp, setCondOp] = useState<RuleOp>("eq");
  const [condValue, setCondValue] = useState("");
  const [stageId, setStageId] = useState(props.mode === "stage" ? (props.stages[0]?.id ?? "") : "");
  const [reqs, setReqs] = useState<RuleRequirement[]>([{ attribute: fields[0]?.slug ?? "name", kind: "required" }]);

  const query = props.mode === "record" ? `object=${props.objectSlug}` : `list=${props.listId}`;
  const load = useCallback(async () => {
    const r = await dataApi<{ rules: StoredRule[] }>(`/api/data/rules?${query}`);
    if (r.ok) setRules(r.data.rules);
    else setError(r.error);
  }, [query]);
  useEffect(() => {
    void load();
  }, [load]);

  const labelOf = (slug: string) => (slug === "name" ? "Name" : (fields.find((f) => f.slug === slug)?.name ?? slug));
  const describe = (r: StoredRule) => {
    const when = r.kind === "stage" ? `Moving into ${props.mode === "stage" ? (props.stages.find((s) => s.id === r.stage_id)?.name ?? "a stage") : "a stage"}` : r.condition ? `When ${labelOf(r.condition.attribute)} ${OP_LABELS[r.condition.op]}${r.condition.value ? ` "${r.condition.value}"` : ""}` : "Always";
    const needs = r.requirements.map((q) => `${labelOf(q.attribute)} ${q.kind === "required" ? "is required" : "must be empty"}`).join("; ");
    return `${when}: ${needs}`;
  };

  async function add() {
    setBusy("add");
    setError(null);
    const base = { name, requirements: reqs };
    const body =
      props.mode === "record"
        ? { kind: "record", object: props.objectSlug, ...base, condition: useCondition ? { attribute: condField, op: condOp, value: condOp === "eq" || condOp === "neq" ? condValue : undefined } : null }
        : { kind: "stage", listId: props.listId, stageId, ...base };
    const r = await dataApi("/api/data/rules", { method: "POST", body });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setName("");
    setUseCondition(false);
    setCondValue("");
    void load();
  }

  async function toggle(rule: StoredRule) {
    setBusy(rule.id);
    const r = await dataApi(`/api/data/rules/${rule.id}`, { method: "PATCH", body: { active: !rule.active } });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    void load();
  }
  async function remove(rule: StoredRule) {
    setBusy(rule.id);
    const r = await dataApi(`/api/data/rules/${rule.id}`, { method: "DELETE" });
    setBusy(null);
    if (!r.ok) return setError(r.error);
    void load();
  }

  if (typeof document === "undefined") return null;
  const lbl = "mb-1 block text-[11.5px] font-semibold uppercase tracking-wide text-[var(--color-text-faint)]";

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 p-4" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-label={props.title} className="card flex max-h-[90vh] w-full max-w-[600px] flex-col shadow-[var(--shadow-lg)]">
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-5 py-3">
          <h2 className="text-[15px] font-semibold">{props.title}</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-[var(--color-text-faint)] hover:text-[var(--color-text)]"><X className="h-4 w-4" /></button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-4 text-[13px]">
          <div>
            <h3 className={lbl}>Rules</h3>
            {rules === null ? (
              <Loader2 className="h-4 w-4 animate-spin text-[var(--color-text-faint)]" />
            ) : rules.length === 0 ? (
              <p className="text-[var(--color-text-muted)]">No rules yet.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-border)] rounded-lg border border-[var(--color-border)]">
                {rules.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2">
                    <div className={r.active ? "" : "text-[var(--color-text-faint)]"}>
                      <p className="font-semibold">{r.name}{!r.active && " (off)"}</p>
                      <p className="text-[12.5px] text-[var(--color-text-muted)]">{describe(r)}</p>
                    </div>
                    <span className="flex shrink-0 gap-3 text-[12.5px] font-semibold">
                      <button type="button" disabled={busy !== null} onClick={() => void toggle(r)} className="underline">{r.active ? "Turn off" : "Turn on"}</button>
                      <button type="button" disabled={busy !== null} onClick={() => void remove(r)} className="text-[var(--color-danger)] underline">Delete</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-[12px] text-[var(--color-text-faint)]">Records that already break a new rule aren&apos;t flagged; they are checked the next time someone saves them.</p>
          </div>

          <form
            className="space-y-3 border-t border-[var(--color-border)] pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              void add();
            }}
          >
            <h3 className={lbl}>New rule</h3>
            <div>
              <label htmlFor="rule-name" className={lbl}>Name</label>
              <input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={100} placeholder={props.mode === "stage" ? "Won deals need a value" : "Customers need a phone number"} className="input-field h-9 text-[13px]" />
            </div>

            {props.mode === "stage" ? (
              <div>
                <label htmlFor="rule-stage" className={lbl}>When a card moves into</label>
                <select id="rule-stage" value={stageId} onChange={(e) => setStageId(e.target.value)} className="input-field select-chevron h-9 text-[13px]">
                  {props.stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="space-y-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={useCondition} onChange={(e) => setUseCondition(e.target.checked)} /> Only when a field has a certain value</label>
                {useCondition && (
                  <div className="flex flex-wrap items-center gap-2">
                    <select aria-label="Field" value={condField} onChange={(e) => setCondField(e.target.value)} className="input-field select-chevron h-8 text-[12.5px]">
                      {fields.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
                    </select>
                    <select aria-label="Condition" value={condOp} onChange={(e) => setCondOp(e.target.value as RuleOp)} className="input-field select-chevron h-8 text-[12.5px]">
                      {(Object.keys(OP_LABELS) as RuleOp[]).map((o) => <option key={o} value={o}>{OP_LABELS[o]}</option>)}
                    </select>
                    {(condOp === "eq" || condOp === "neq") && <input aria-label="Value" value={condValue} onChange={(e) => setCondValue(e.target.value)} className="input-field h-8 w-[160px] text-[12.5px]" />}
                  </div>
                )}
              </div>
            )}

            <div className="space-y-2">
              <p className={lbl}>Then</p>
              {reqs.map((q, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2">
                  <select aria-label="Field" value={q.attribute} onChange={(e) => setReqs((rs) => rs.map((x, j) => (j === i ? { ...x, attribute: e.target.value } : x)))} className="input-field select-chevron h-8 text-[12.5px]">
                    <option value="name">Name</option>
                    {fields.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
                  </select>
                  <select aria-label="Requirement" value={q.kind} onChange={(e) => setReqs((rs) => rs.map((x, j) => (j === i ? { ...x, kind: e.target.value as RuleRequirement["kind"] } : x)))} className="input-field select-chevron h-8 text-[12.5px]">
                    <option value="required">is required</option>
                    <option value="empty">must be empty</option>
                  </select>
                  {reqs.length > 1 && (
                    <button type="button" aria-label="Remove requirement" onClick={() => setReqs((rs) => rs.filter((_, j) => j !== i))} className="text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"><X className="h-3.5 w-3.5" /></button>
                  )}
                </div>
              ))}
              {reqs.length < 8 && (
                <button type="button" onClick={() => setReqs((rs) => [...rs, { attribute: fields[0]?.slug ?? "name", kind: "required" }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                  <Plus className="h-3.5 w-3.5" /> Another requirement
                </button>
              )}
            </div>

            <button type="submit" disabled={busy !== null || !name.trim()} className="btn-primary-copper inline-flex items-center gap-2">
              {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}
              Add rule
            </button>
          </form>

          {error && <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">{error}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
