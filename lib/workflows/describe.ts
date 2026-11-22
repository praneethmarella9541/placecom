import { BLOCK_LABELS } from "./graph";
import type { Block, Condition, FieldSet, Graph, Trigger, TriggerType } from "./types";

/** Words for the builder and the run viewer. Pure and client-safe. */

export type MetaAttribute = { slug: string; name: string; type: string; is_multi: boolean; config: { options?: string[]; target_object?: string } };
export type MetaObject = { slug: string; singular_name: string; plural_name: string; attributes: MetaAttribute[] };
export type MetaList = { id: string; name: string; object_slug: string | null; has_stages: boolean; stages: { id: string; name: string }[] };
export type MetaMember = { id: string; name: string; is_admin: boolean };
export type WorkflowMeta = { objects: MetaObject[]; lists: MetaList[]; members: MetaMember[] };

export const TRIGGER_LABELS: Record<TriggerType, string> = {
  record_created: "A record is created",
  record_updated: "A record is updated",
  attribute_changed: "A field changes",
  list_added: "A record is added to a list",
  list_entry_updated: "A list entry changes",
  rule_matched: "A validation rule blocks, warns, or is bypassed",
  manual: "Run by hand on a record",
  schedule: "On a schedule",
};

const RULE_OUTCOME_LABELS: Record<string, string> = { blocked: "blocks a save", warned: "warns on a save", bypassed: "is bypassed by an admin" };

const OPS: Record<string, string> = { eq: "is", neq: "is not", contains: "contains", not_contains: "doesn't contain", gt: "is more than", lt: "is less than", empty: "is empty", not_empty: "is not empty" };
export const CONDITION_OP_LABELS = OPS;

const objectName = (meta: WorkflowMeta | null, slug: unknown) => meta?.objects.find((o) => o.slug === slug)?.plural_name.toLowerCase() ?? String(slug ?? "…");
const listName = (meta: WorkflowMeta | null, id: unknown) => meta?.lists.find((l) => l.id === id)?.name ?? "a list";
const stageName = (meta: WorkflowMeta | null, listId: unknown, stageId: unknown) => meta?.lists.find((l) => l.id === listId)?.stages.find((s) => s.id === stageId)?.name;
const fieldName = (meta: WorkflowMeta | null, objectSlug: unknown, slug: unknown) => (slug === "name" ? "Name" : (meta?.objects.find((o) => o.slug === objectSlug)?.attributes.find((a) => a.slug === slug)?.name ?? String(slug ?? "")));

export function describeTrigger(t: Trigger, meta: WorkflowMeta | null): string {
  const c = t.config;
  switch (t.type) {
    case null:
      return "Choose what starts this workflow";
    case "record_created":
      return `A ${objectName(meta, c.object)} record is created`;
    case "record_updated":
      return `A ${objectName(meta, c.object)} record is updated`;
    case "attribute_changed":
      return `${fieldName(meta, c.object, c.attribute)} changes${c.to ? ` to "${c.to}"` : ""}${c.from ? ` from "${c.from}"` : ""}`;
    case "list_added":
      return `A record is added to ${listName(meta, c.list)}`;
    case "list_entry_updated":
      return `An entry in ${listName(meta, c.list)} changes${c.attribute === "stage" ? " stage" : ""}${c.to ? ` to ${stageName(meta, c.list, c.to) ?? `"${c.to}"`}` : ""}`;
    case "rule_matched": {
      const outcome = typeof c.outcome === "string" ? RULE_OUTCOME_LABELS[c.outcome] : undefined;
      return `A rule on ${objectName(meta, c.object)}${c.apiName ? ` ("${c.apiName}")` : ""} ${outcome ?? "matches"}`;
    }
    case "manual":
      return `Run by hand on a ${objectName(meta, c.object)} record`;
    case "schedule":
      return c.every === "hour" ? "Every hour" : c.every === "day" ? `Every day at ${c.at}` : `Every week on ${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][Number(c.weekday)] ?? "Monday"} at ${c.at}`;
  }
}

const cond = (c: Condition) => `${c.left.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_m, p: string) => p.split(".").slice(-1)[0])} ${OPS[c.op] ?? c.op}${c.op === "empty" || c.op === "not_empty" ? "" : ` ${c.right ?? ""}`}`;

/** One line under a block's name on the canvas. */
export function describeBlock(b: Block, meta: WorkflowMeta | null): string {
  const c = b.config;
  switch (b.type) {
    case "filter":
    case "if_else": {
      if (c.conditionFormat === "formula") return typeof c.formula === "string" && c.formula.trim() ? c.formula.trim().slice(0, 80) : "No formula yet";
      const list = (c.conditions as Condition[]) ?? [];
      return list.length ? list.map(cond).join(c.match === "any" ? " or " : " and ").slice(0, 80) : "No conditions yet";
    }
    case "delay":
      return `Wait ${c.amount} ${c.unit}`;
    case "update_record":
      return ((c.fields as FieldSet[]) ?? []).length ? `Set ${(c.fields as FieldSet[]).map((f) => f.attribute).join(", ")}` : "Nothing to set yet";
    case "create_record":
      return c.object ? `New ${String(objectName(meta, c.object)).replace(/s$/, "")}` : "Choose a kind of record";
    case "find_records":
      return c.object ? `Look for ${objectName(meta, c.object)}` : "Choose a kind of record";
    case "add_to_list":
      return c.list ? `Add to ${listName(meta, c.list)}${c.stage ? ` · ${stageName(meta, c.list, c.stage) ?? ""}` : ""}` : "Choose a list";
    case "update_list_entry":
      return c.list ? `Update entry in ${listName(meta, c.list)}${c.stage ? ` · move to ${stageName(meta, c.list, c.stage) ?? ""}` : ""}` : "Choose a list";
    case "create_note":
      return String(c.body ?? "").slice(0, 60) || "Write the note";
    case "create_task":
      return String(c.title ?? "").slice(0, 60) || "Give the task a title";
    case "send_notification":
      return String(c.title ?? "").slice(0, 60) || "Give it a title";
  }
}

export const blockTitle = (b: Block) => b.label?.trim() || BLOCK_LABELS[b.type];

/** Blocks on the way from the start to `key` (not including it), so a block can offer their outputs as variables. */
export function ancestorsOf(graph: Graph, key: string): Block[] {
  const path: Block[] = [];
  const find = (k: string | null | undefined, trail: Block[]): boolean => {
    if (!k || !graph.blocks[k]) return false;
    const b = graph.blocks[k];
    if (k === key) {
      path.push(...trail);
      return true;
    }
    const next = b.type === "if_else" ? [b.yes, b.no] : [b.next];
    return next.some((n) => find(n, [...trail, b]));
  };
  find(graph.start, []);
  return path;
}

export type VariableOption = { path: string; label: string };

/** Variables a block may use: the trigger record and event, and each earlier block's output. */
export function variablesFor(graph: Graph, key: string | null, trigger: Trigger, meta: WorkflowMeta | null): VariableOption[] {
  const out: VariableOption[] = [];
  const hasRecord = trigger.type && trigger.type !== "schedule";
  if (hasRecord) {
    out.push({ path: "trigger.record.id", label: "Trigger record · id" }, { path: "trigger.record.name", label: "Trigger record · name" });
    const objectSlug = (trigger.config.object as string | undefined) ?? undefined;
    const obj = meta?.objects.find((o) => o.slug === objectSlug);
    for (const a of obj?.attributes ?? []) out.push({ path: `trigger.record.values.${a.slug}`, label: `Trigger record · ${a.name}` });
  }
  if (trigger.type === "attribute_changed" || trigger.type === "list_entry_updated") out.push({ path: "trigger.event.new_value", label: "Trigger · new value" }, { path: "trigger.event.old_value", label: "Trigger · old value" });
  if (trigger.type === "rule_matched") {
    out.push(
      { path: "trigger.event.ruleName", label: "Trigger · rule name" },
      { path: "trigger.event.ruleApiName", label: "Trigger · rule API name" },
      { path: "trigger.event.outcome", label: "Trigger · outcome (blocked, warned, bypassed)" },
      { path: "trigger.event.message", label: "Trigger · rule message" }
    );
  }
  if (trigger.type) out.push({ path: "trigger.event.actor_kind", label: "Trigger · changed by (user or workflow)" });

  const before = key ? ancestorsOf(graph, key) : Object.values(graph.blocks);
  for (const b of before) {
    const t = blockTitle(b);
    switch (b.type) {
      case "find_records":
        out.push({ path: `${b.key}.found`, label: `${t} · how many found` }, { path: `${b.key}.record.id`, label: `${t} · first record id` }, { path: `${b.key}.record.name`, label: `${t} · first record name` });
        break;
      case "create_record":
      case "update_record":
        out.push({ path: `${b.key}.record.id`, label: `${t} · record id` }, { path: `${b.key}.record.name`, label: `${t} · record name` });
        break;
      case "add_to_list":
      case "update_list_entry":
        out.push({ path: `${b.key}.entry_id`, label: `${t} · list entry id` });
        break;
      case "create_task":
        out.push({ path: `${b.key}.task_id`, label: `${t} · task id` });
        break;
    }
  }
  return out;
}
