"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Plus, X } from "lucide-react";
import type { AttributeDef } from "@/lib/data-model/types";
import type { RuleCondition, RuleOp, RuleRequirement } from "@/lib/data-model/rules";
import type { RuleTemplate } from "@/lib/data-model/rule-templates";
import { dataApi } from "@/lib/data-model/client";

type StoredRule = {
  id: string;
  kind: "record" | "stage";
  name: string;
  condition: RuleCondition;
  requirements: RuleRequirement[];
  active: boolean;
  stage_id: string | null;
  format?: "legacy" | "formula";
  api_name?: string | null;
  description?: string | null;
  applies_on?: "create" | "update" | "both";
  mode?: "block" | "warn";
  error_location?: string | null;
  message?: string | null;
  expression_source?: string | null;
};
type Stage = { id: string; name: string };

const APPLIES_ON_LABELS = { create: "On create only", update: "On update only", both: "On create and update" } as const;

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

  const [formType, setFormType] = useState<"simple" | "formula">("simple");

  const [name, setName] = useState("");
  const [useCondition, setUseCondition] = useState(false);
  const [condField, setCondField] = useState(fields[0]?.slug ?? "");
  const [condOp, setCondOp] = useState<RuleOp>("eq");
  const [condValue, setCondValue] = useState("");
  const [stageId, setStageId] = useState(props.mode === "stage" ? (props.stages[0]?.id ?? "") : "");
  const [reqs, setReqs] = useState<RuleRequirement[]>([{ attribute: fields[0]?.slug ?? "name", kind: "required" }]);

  // Formula rule fields. API name auto-follows the name until the admin edits it directly.
  const [apiName, setApiName] = useState("");
  const [apiNameTouched, setApiNameTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [appliesOn, setAppliesOn] = useState<"create" | "update" | "both">("both");
  const [ruleMode, setRuleMode] = useState<"block" | "warn">("block");
  const [errorLocation, setErrorLocation] = useState("");
  const [message, setMessage] = useState("");
  const [expressionSource, setExpressionSource] = useState("");
  const [adminBypass, setAdminBypass] = useState(false);
  const [formulaError, setFormulaError] = useState<{ message: string; pos?: { start: number; end: number } } | null>(null);

  // Templates: starter formulas, fetched once, offered as a picker above the formula textarea.
  const [templates, setTemplates] = useState<RuleTemplate[] | null>(null);
  useEffect(() => {
    if (formType !== "formula" || templates !== null) return;
    void dataApi<{ templates: RuleTemplate[] }>("/api/data/rules/templates").then((r) => r.ok && setTemplates(r.data.templates));
  }, [formType, templates]);

  function applyTemplate(id: string) {
    const t = templates?.find((x) => x.id === id);
    if (!t) return;
    nameChanged(t.label);
    setRuleMode(t.mode);
    setMessage(t.message);
    setExpressionSource(t.expressionSource);
    setFormulaError(null);
  }

  // Test panel: tries the form's current rule (saved or not) against made-up values — the same
  // check a real save would run, with nothing written anywhere.
  const [testOpen, setTestOpen] = useState(false);
  const [testName, setTestName] = useState("");
  const [testValues, setTestValues] = useState("{\n  \n}");
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState<{ matched: boolean; messages: string[]; mode: "block" | "warn" } | { error: string } | null>(null);

  async function runTest() {
    setTestBusy(true);
    setTestResult(null);
    let values: unknown;
    try {
      values = JSON.parse(testValues);
    } catch {
      setTestBusy(false);
      setTestResult({ error: "Test values must be valid JSON, e.g. { \"field_slug\": \"value\" }." });
      return;
    }
    const base =
      formType === "formula"
        ? { format: "formula", apiName: apiName || "test", appliesOn, mode: ruleMode, errorLocation: errorLocation || undefined, message: message.trim() || undefined, expressionSource }
        : { requirements: reqs, condition: props.mode === "record" && useCondition ? { attribute: condField, op: condOp, value: condOp === "eq" || condOp === "neq" ? condValue : undefined } : null };
    const body =
      props.mode === "record"
        ? { kind: "record", object: props.objectSlug, ...base, values, name: testName || undefined }
        : { kind: "stage", listId: props.listId, stageId, ...base, values, name: testName || undefined };
    const r = await dataApi<{ matched: boolean; messages: string[]; mode: "block" | "warn" }>("/api/data/rules/test", { method: "POST", body });
    setTestBusy(false);
    setTestResult(r.ok ? r.data : { error: r.error });
  }

  function nameChanged(v: string) {
    setName(v);
    if (!apiNameTouched) {
      setApiName(
        v
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "")
          .replace(/^[^a-z]+/, "")
          .slice(0, 60) || ""
      );
    }
  }

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
    if (r.format === "formula") {
      const scope = r.kind === "record" && r.applies_on && r.applies_on !== "both" ? ` (${APPLIES_ON_LABELS[r.applies_on].toLowerCase()})` : "";
      return `Formula${scope}: ${r.expression_source ?? ""}`;
    }
    const when = r.kind === "stage" ? `Moving into ${props.mode === "stage" ? (props.stages.find((s) => s.id === r.stage_id)?.name ?? "a stage") : "a stage"}` : r.condition ? `When ${labelOf(r.condition.attribute)} ${OP_LABELS[r.condition.op]}${r.condition.value ? ` "${r.condition.value}"` : ""}` : "Always";
    const needs = r.requirements
      .map((q) => {
        if (q.kind === "required") return `${labelOf(q.attribute)} is required`;
        if (q.kind === "empty") return `${labelOf(q.attribute)} must be empty`;
        return `${labelOf(q.attribute)} must be ${q.kind === "gte" ? "at least" : "at most"} ${q.value}`;
      })
      .join("; ");
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

  async function addFormula() {
    setBusy("add");
    setError(null);
    setFormulaError(null);
    const base = {
      format: "formula",
      name,
      apiName,
      description: description.trim() || undefined,
      mode: ruleMode,
      errorLocation: errorLocation || undefined,
      message: message.trim() || undefined,
      expressionSource,
      adminBypass,
    };
    const body =
      props.mode === "record"
        ? { kind: "record", object: props.objectSlug, ...base, appliesOn }
        : { kind: "stage", listId: props.listId, stageId, ...base };
    const r = await dataApi<{ rule?: unknown }>("/api/data/rules", { method: "POST", body });
    setBusy(null);
    if (!r.ok) {
      setFormulaError({ message: r.error, pos: r.pos });
      return;
    }
    setName("");
    setApiName("");
    setApiNameTouched(false);
    setDescription("");
    setErrorLocation("");
    setMessage("");
    setExpressionSource("");
    setAdminBypass(false);
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

  // Impact scan (formula rules only — see lib/data-model/rule-engine-bridge.ts's scanRuleImpact):
  // how much of what's already there would fail this rule right now.
  const [impact, setImpact] = useState<Record<string, { scanned: number; failing: number; truncated: boolean } | { error: string } | "loading">>({});
  async function checkImpact(rule: StoredRule) {
    setImpact((m) => ({ ...m, [rule.id]: "loading" }));
    const r = await dataApi<{ scanned: number; failing: number; truncated: boolean }>(`/api/data/rules/${rule.id}/impact`, { method: "POST" });
    setImpact((m) => ({ ...m, [rule.id]: r.ok ? r.data : { error: r.error } }));
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
                      {r.format === "formula" && impact[r.id] && impact[r.id] !== "loading" && (
                        "error" in (impact[r.id] as object)
                          ? <p className="text-[12px] text-[var(--color-danger)]">{(impact[r.id] as { error: string }).error}</p>
                          : (() => {
                              const i = impact[r.id] as { scanned: number; failing: number; truncated: boolean };
                              return (
                                <p className="text-[12px] text-[var(--color-text-faint)]">
                                  {i.failing} of {i.scanned}{i.truncated ? "+" : ""} existing record{i.scanned === 1 ? "" : "s"} would currently fail this rule.
                                </p>
                              );
                            })()
                      )}
                    </div>
                    <span className="flex shrink-0 items-start gap-3 text-[12.5px] font-semibold">
                      {r.format === "formula" && (
                        <button type="button" disabled={impact[r.id] === "loading"} onClick={() => void checkImpact(r)} className="underline">
                          {impact[r.id] === "loading" ? "Checking…" : "Check impact"}
                        </button>
                      )}
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
              void (formType === "formula" ? addFormula() : add());
            }}
          >
            <div className="flex items-center justify-between">
              <h3 className={lbl}>New rule</h3>
              <div className="flex gap-1 rounded-lg border border-[var(--color-border)] p-0.5 text-[12px] font-semibold">
                <button type="button" onClick={() => setFormType("simple")} className={`rounded-md px-2 py-1 ${formType === "simple" ? "bg-[var(--color-surface-alt)]" : "text-[var(--color-text-faint)]"}`}>Simple</button>
                <button type="button" onClick={() => setFormType("formula")} className={`rounded-md px-2 py-1 ${formType === "formula" ? "bg-[var(--color-surface-alt)]" : "text-[var(--color-text-faint)]"}`}>Formula</button>
              </div>
            </div>
            <div>
              <label htmlFor="rule-name" className={lbl}>Name</label>
              <input id="rule-name" value={name} onChange={(e) => (formType === "formula" ? nameChanged(e.target.value) : setName(e.target.value))} maxLength={100} placeholder={props.mode === "stage" ? "Won deals need a value" : "Customers need a phone number"} className="input-field h-9 text-[13px]" />
            </div>

            {props.mode === "stage" && (
              <div>
                <label htmlFor="rule-stage" className={lbl}>When a card moves into</label>
                <select id="rule-stage" value={stageId} onChange={(e) => setStageId(e.target.value)} className="input-field select-chevron h-9 text-[13px]">
                  {props.stages.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            )}

            {formType === "simple" ? (
              <>
                {props.mode === "record" && (
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
                  {reqs.map((q, i) => {
                    const attr = q.attribute === "name" ? undefined : fields.find((f) => f.slug === q.attribute);
                    const hasThreshold = !!attr && (attr.type === "number" || attr.type === "currency" || attr.type === "rating" || attr.type === "date");
                    return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <select aria-label="Field" value={q.attribute} onChange={(e) => setReqs((rs) => rs.map((x, j) => (j === i ? { attribute: e.target.value, kind: "required" } : x)))} className="input-field select-chevron h-8 text-[12.5px]">
                        <option value="name">Name</option>
                        {fields.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
                      </select>
                      <select aria-label="Requirement" value={q.kind} onChange={(e) => setReqs((rs) => rs.map((x, j) => (j === i ? { ...x, kind: e.target.value as RuleRequirement["kind"], value: undefined } : x)))} className="input-field select-chevron h-8 text-[12.5px]">
                        <option value="required">is required</option>
                        <option value="empty">must be empty</option>
                        {hasThreshold && <option value="gte">is at least</option>}
                        {hasThreshold && <option value="lte">is at most</option>}
                      </select>
                      {(q.kind === "gte" || q.kind === "lte") && (
                        <input
                          aria-label="Threshold"
                          type={attr?.type === "date" ? "date" : "number"}
                          value={q.value ?? ""}
                          onChange={(e) => setReqs((rs) => rs.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                          className="input-field h-8 w-[140px] text-[12.5px]"
                        />
                      )}
                      {reqs.length > 1 && (
                        <button type="button" aria-label="Remove requirement" onClick={() => setReqs((rs) => rs.filter((_, j) => j !== i))} className="text-[var(--color-text-faint)] hover:text-[var(--color-danger)]"><X className="h-3.5 w-3.5" /></button>
                      )}
                    </div>
                    );
                  })}
                  {reqs.length < 8 && (
                    <button type="button" onClick={() => setReqs((rs) => [...rs, { attribute: fields[0]?.slug ?? "name", kind: "required" }])} className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
                      <Plus className="h-3.5 w-3.5" /> Another requirement
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                {templates && templates.length > 0 && (
                  <div>
                    <label htmlFor="rule-template" className={lbl}>Start from a template (optional)</label>
                    <select id="rule-template" defaultValue="" onChange={(e) => e.target.value && applyTemplate(e.target.value)} className="input-field select-chevron h-9 text-[12.5px]">
                      <option value="">Blank formula</option>
                      {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </select>
                    <p className="mt-1 text-[11.5px] text-[var(--color-text-faint)]">Fills in a starting formula with ALL_CAPS placeholders to replace with real field names and values.</p>
                  </div>
                )}
                <div>
                  <label htmlFor="rule-api-name" className={lbl}>API name</label>
                  <input id="rule-api-name" value={apiName} onChange={(e) => { setApiNameTouched(true); setApiName(e.target.value); }} maxLength={60} placeholder="package_value_minimum" className="input-field h-9 font-mono text-[12.5px]" />
                </div>
                <div>
                  <label htmlFor="rule-description" className={lbl}>Description (optional)</label>
                  <input id="rule-description" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} className="input-field h-9 text-[13px]" />
                </div>
                <div className="flex flex-wrap gap-3">
                  {props.mode === "record" && (
                    <div>
                      <label htmlFor="rule-applies-on" className={lbl}>Applies on</label>
                      <select id="rule-applies-on" value={appliesOn} onChange={(e) => setAppliesOn(e.target.value as typeof appliesOn)} className="input-field select-chevron h-8 text-[12.5px]">
                        {(Object.keys(APPLIES_ON_LABELS) as (keyof typeof APPLIES_ON_LABELS)[]).map((k) => <option key={k} value={k}>{APPLIES_ON_LABELS[k]}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label htmlFor="rule-mode" className={lbl}>Mode</label>
                    <select id="rule-mode" value={ruleMode} onChange={(e) => setRuleMode(e.target.value as typeof ruleMode)} className="input-field select-chevron h-8 text-[12.5px]">
                      <option value="block">Block the save</option>
                      <option value="warn">Warn, but allow the save</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="rule-error-location" className={lbl}>Error shows on</label>
                    <select id="rule-error-location" value={errorLocation} onChange={(e) => setErrorLocation(e.target.value)} className="input-field select-chevron h-8 text-[12.5px]">
                      <option value="">Top of form</option>
                      <option value="name">Name</option>
                      {fields.map((f) => <option key={f.slug} value={f.slug}>{f.name}</option>)}
                    </select>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[12.5px]">
                  <input type="checkbox" checked={adminBypass} onChange={(e) => setAdminBypass(e.target.checked)} />
                  Let an admin override a block on this rule (logged when they do)
                </label>
                <div>
                  <label htmlFor="rule-message" className={lbl}>Message (optional — can use {"{{field_slug}}"})</label>
                  <input id="rule-message" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={500} placeholder="Package value must be at least 90000 (got {{package_value}})" className="input-field h-9 text-[13px]" />
                </div>
                <div>
                  <label htmlFor="rule-formula" className={lbl}>Formula — TRUE means the record is invalid</label>
                  <textarea
                    id="rule-formula"
                    value={expressionSource}
                    onChange={(e) => setExpressionSource(e.target.value)}
                    maxLength={4000}
                    rows={3}
                    placeholder="package_value < 90000"
                    className="input-field w-full resize-y font-mono text-[12.5px]"
                  />
                  {formulaError && (
                    <p role="alert" className="mt-1 rounded-lg bg-[var(--color-danger-light)] px-2 py-1.5 text-[12px] text-[var(--color-danger)]">
                      {formulaError.pos ? `Position ${formulaError.pos.start}–${formulaError.pos.end}: ` : ""}{formulaError.message}
                    </p>
                  )}
                </div>
              </>
            )}

            <div className="flex items-center gap-2">
              <button type="submit" disabled={busy !== null || !name.trim() || (formType === "formula" ? (!apiName.trim() || !expressionSource.trim()) : reqs.some((r) => (r.kind === "gte" || r.kind === "lte") && !String(r.value ?? "").trim()))} className="btn-primary-copper inline-flex items-center gap-2">
                {busy === "add" && <Loader2 className="h-4 w-4 animate-spin" />}
                Add rule
              </button>
              <button type="button" onClick={() => setTestOpen((v) => !v)} className="text-[12.5px] font-semibold text-[var(--color-text-muted)] underline hover:text-[var(--color-text)]">
                {testOpen ? "Hide test panel" : "Test this rule"}
              </button>
            </div>

            {testOpen && (
              <div className="space-y-2 rounded-lg border border-[var(--color-border)] p-3">
                <p className={lbl}>Test panel — tries the rule above against made-up values; nothing is saved.</p>
                <div>
                  <label htmlFor="rule-test-name" className={lbl}>Name (optional)</label>
                  <input id="rule-test-name" value={testName} onChange={(e) => setTestName(e.target.value)} className="input-field h-8 text-[12.5px]" />
                </div>
                <div>
                  <label htmlFor="rule-test-values" className={lbl}>Test values (JSON, by field slug)</label>
                  <textarea id="rule-test-values" value={testValues} onChange={(e) => setTestValues(e.target.value)} rows={3} className="input-field w-full resize-y font-mono text-[12.5px]" />
                </div>
                <button type="button" disabled={testBusy} onClick={() => void runTest()} className="btn-secondary inline-flex items-center gap-2 text-[12.5px]">
                  {testBusy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Run test
                </button>
                {testResult && (
                  "error" in testResult ? (
                    <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-2 py-1.5 text-[12px] text-[var(--color-danger)]">{testResult.error}</p>
                  ) : (
                    <p className={`rounded-lg px-2 py-1.5 text-[12.5px] ${testResult.matched ? (testResult.mode === "warn" ? "bg-[var(--color-warning-light)] text-[var(--color-warning)]" : "bg-[var(--color-danger-light)] text-[var(--color-danger)]") : "bg-[var(--color-success-light)] text-[var(--color-success)]"}`}>
                      {testResult.matched ? `${testResult.mode === "warn" ? "Would warn" : "Would block"}: ${testResult.messages.join(" ")}` : "Would pass — this rule doesn't match these values."}
                    </p>
                  )
                )}
              </div>
            )}
          </form>

          {error && <p role="alert" className="rounded-lg bg-[var(--color-danger-light)] px-3 py-2 text-[12.5px] text-[var(--color-danger)]">{error}</p>}
        </div>
      </div>
    </div>,
    document.body
  );
}
