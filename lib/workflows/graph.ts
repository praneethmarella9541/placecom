import { isOp } from "./conditions";
import type { Block, BlockType, Condition, FieldSet, Graph } from "./types";
import { BLOCK_TYPES, EMPTY_GRAPH, LIMITS } from "./types";

/**
 * The block tree: validating it, and the edits the builder makes. Pure, so the same rules run in
 * the browser (to guide) and on the server (to enforce), and are tested in graph.test.mts.
 *
 * Shape: { start, blocks }. A block continues with `next`; an if/else has `yes` and `no`. A null
 * pointer ends that path. Every block has exactly one parent (a tree: paths split but never rejoin),
 * which also rules out loops.
 */

const KEY = /^b[0-9a-z]{1,8}$/;
const SLUG = /^[a-z][a-z0-9_]{0,39}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_MAX = 2000;

export const BLOCK_LABELS: Record<BlockType, string> = {
  filter: "Filter",
  if_else: "If / else",
  delay: "Delay",
  update_record: "Update record",
  create_record: "Create record",
  find_records: "Find records",
  add_to_list: "Add to list",
  update_list_entry: "Update list entry",
  create_note: "Create note",
  create_task: "Create task",
  send_notification: "Send notification",
};

export const BLOCK_GROUPS: { label: string; types: BlockType[] }[] = [
  { label: "Logic", types: ["filter", "if_else", "delay"] },
  { label: "Records and lists", types: ["update_record", "create_record", "find_records", "add_to_list", "update_list_entry"] },
  { label: "Activity", types: ["create_note", "create_task", "send_notification"] },
];

/** What a new block starts with. */
export function defaultConfig(type: BlockType): Record<string, unknown> {
  switch (type) {
    case "filter":
    case "if_else":
      return { match: "all", conditions: [{ left: "{{trigger.record.name}}", op: "not_empty", right: "" }] };
    case "delay":
      return { amount: 1, unit: "days" };
    case "update_record":
      return { record: "{{trigger.record.id}}", fields: [] };
    case "create_record":
      return { object: "", name: "", fields: [] };
    case "find_records":
      return { object: "", match: "all", conditions: [{ attribute: "name", op: "contains", value: "" }] };
    case "add_to_list":
      return { list: "", record: "{{trigger.record.id}}", stage: "" };
    case "update_list_entry":
      return { list: "", record: "{{trigger.record.id}}", stage: "", fields: [] };
    case "create_note":
      return { record: "{{trigger.record.id}}", kind: "note", body: "" };
    case "create_task":
      return { record: "{{trigger.record.id}}", title: "", dueInDays: 3, assignee: "owner" };
    case "send_notification":
      return { to: "owner", title: "", body: "", linkToRecord: true };
  }
}

type Cleaned = { ok: true; config: Record<string, unknown> } | { ok: false; error: string };

const text = (v: unknown, max = TEXT_MAX) => (typeof v === "string" ? v.slice(0, max) : "");

function cleanConditions(raw: unknown): Condition[] | string {
  if (!Array.isArray(raw) || raw.length > 10) return "Use at most 10 conditions.";
  const out: Condition[] = [];
  for (const c of raw as { left?: unknown; op?: unknown; right?: unknown }[]) {
    if (!c || typeof c.left !== "string" || !c.left.trim() || !isOp(c.op)) return "A condition isn't complete.";
    out.push({ left: text(c.left, 500), op: c.op, right: text(c.right, 500) });
  }
  return out;
}

function cleanFields(raw: unknown): FieldSet[] | string {
  if (!Array.isArray(raw) || raw.length > 20) return "Set at most 20 fields.";
  const out: FieldSet[] = [];
  for (const f of raw as { attribute?: unknown; value?: unknown }[]) {
    if (!f || typeof f.attribute !== "string" || !(f.attribute === "name" || SLUG.test(f.attribute))) return "A field to set isn't valid.";
    out.push({ attribute: f.attribute, value: text(f.value, 2000) });
  }
  return out;
}

const id = (v: unknown) => (typeof v === "string" && UUID.test(v) ? v : "");

/** The rules for one block's settings. Returns the cleaned settings or the first problem. */
export function sanitizeBlockConfig(type: BlockType, raw: unknown): Cleaned {
  const c = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const fail = (error: string): Cleaned => ({ ok: false, error });

  switch (type) {
    case "filter":
    case "if_else": {
      // A formula condition (lib/workflows/condition-formula.ts) is checked for syntax and field
      // references when the workflow actually runs, not here — this function has no graph/trigger
      // context to build the real schema from, only the raw config.
      if (c.conditionFormat === "formula") {
        const formula = text(c.formula, 4000).trim();
        if (!formula) return fail("Write a formula.");
        return { ok: true, config: { conditionFormat: "formula", formula } };
      }
      const conditions = cleanConditions(c.conditions);
      if (typeof conditions === "string") return fail(conditions);
      return { ok: true, config: { match: c.match === "any" ? "any" : "all", conditions } };
    }
    case "delay": {
      const amount = Number(c.amount);
      const unit = c.unit === "minutes" || c.unit === "hours" || c.unit === "days" ? c.unit : null;
      if (!unit || !Number.isFinite(amount) || amount <= 0) return fail("Set how long to wait.");
      const days = unit === "days" ? amount : unit === "hours" ? amount / 24 : amount / 1440;
      if (days > LIMITS.maxDelayDays) return fail(`A delay can be at most ${LIMITS.maxDelayDays} days.`);
      return { ok: true, config: { amount: Math.round(amount * 100) / 100, unit } };
    }
    case "update_record": {
      const fields = cleanFields(c.fields);
      if (typeof fields === "string") return fail(fields);
      return { ok: true, config: { record: text(c.record, 200) || "{{trigger.record.id}}", fields } };
    }
    case "create_record": {
      const fields = cleanFields(c.fields);
      if (typeof fields === "string") return fail(fields);
      if (typeof c.object !== "string" || !SLUG.test(c.object)) return fail("Choose which kind of record to create.");
      return { ok: true, config: { object: c.object, name: text(c.name, 500), fields } };
    }
    case "find_records": {
      if (typeof c.object !== "string" || !SLUG.test(c.object)) return fail("Choose which kind of record to look for.");
      if (!Array.isArray(c.conditions) || c.conditions.length > 5) return fail("Use at most 5 conditions.");
      const conditions: { attribute: string; op: string; value: string }[] = [];
      for (const k of c.conditions as { attribute?: unknown; op?: unknown; value?: unknown }[]) {
        if (!k || typeof k.attribute !== "string" || !(k.attribute === "name" || SLUG.test(k.attribute)) || !["eq", "neq", "contains", "empty", "not_empty"].includes(String(k.op))) return fail("A search condition isn't complete.");
        conditions.push({ attribute: k.attribute, op: String(k.op), value: text(k.value, 300) });
      }
      return { ok: true, config: { object: c.object, match: "all", conditions } };
    }
    case "add_to_list": {
      if (!id(c.list)) return fail("Choose a list.");
      return { ok: true, config: { list: id(c.list), record: text(c.record, 200) || "{{trigger.record.id}}", stage: id(c.stage) } };
    }
    case "update_list_entry": {
      if (!id(c.list)) return fail("Choose a list.");
      const fields = cleanFields(c.fields);
      if (typeof fields === "string") return fail(fields);
      return { ok: true, config: { list: id(c.list), record: text(c.record, 200) || "{{trigger.record.id}}", stage: id(c.stage), fields } };
    }
    case "create_note": {
      const kind = ["note", "call", "email", "meeting"].includes(String(c.kind)) ? String(c.kind) : "note";
      if (!text(c.body).trim()) return fail("Write the note.");
      return { ok: true, config: { record: text(c.record, 200) || "{{trigger.record.id}}", kind, body: text(c.body, 10000) } };
    }
    case "create_task": {
      if (!text(c.title).trim()) return fail("Give the task a title.");
      const due = c.dueInDays === null || c.dueInDays === "" || c.dueInDays === undefined ? null : Number(c.dueInDays);
      if (due !== null && (!Number.isInteger(due) || due < 0 || due > 3650)) return fail("Due in a whole number of days from 0 to 3650.");
      const assignee = c.assignee === "owner" || c.assignee === "" || c.assignee === undefined ? (c.assignee ?? "owner") : id(c.assignee) || /^field:[a-z][a-z0-9_]{0,39}$/.test(String(c.assignee)) ? String(c.assignee) : "owner";
      return { ok: true, config: { record: text(c.record, 200) || "{{trigger.record.id}}", title: text(c.title, 300), dueInDays: due, assignee } };
    }
    case "send_notification": {
      if (!text(c.title).trim()) return fail("Give the notification a title.");
      const to = c.to === "owner" || id(c.to) || /^field:[a-z][a-z0-9_]{0,39}$/.test(String(c.to)) ? String(c.to) : "owner";
      return { ok: true, config: { to, title: text(c.title, 200), body: text(c.body, 2000), linkToRecord: c.linkToRecord !== false } };
    }
  }
}

function slotsOf(b: Block): ("next" | "yes" | "no")[] {
  return b.type === "if_else" ? ["yes", "no"] : ["next"];
}
const targets = (b: Block): string[] => slotsOf(b).map((s) => b[s]).filter((x): x is string => typeof x === "string");

export type GraphResult = { ok: true; graph: Graph } | { ok: false; errors: string[] };

/**
 * Check a graph and return it cleaned. `forPublish` additionally requires a start block and every
 * block's settings to be complete; a draft only needs to be well-formed.
 */
export function validateGraph(raw: unknown, forPublish = false): GraphResult {
  const errors: string[] = [];
  const input = (raw ?? EMPTY_GRAPH) as { start?: unknown; blocks?: unknown };
  const blocksIn = input.blocks && typeof input.blocks === "object" && !Array.isArray(input.blocks) ? (input.blocks as Record<string, Record<string, unknown>>) : null;
  if (!blocksIn) return { ok: false, errors: ["The workflow's blocks aren't valid."] };
  const keys = Object.keys(blocksIn);
  if (keys.length > LIMITS.maxBlocks) return { ok: false, errors: [`A workflow can have at most ${LIMITS.maxBlocks} blocks.`] };

  const blocks: Record<string, Block> = {};
  for (const key of keys) {
    const b = blocksIn[key];
    if (!KEY.test(key) || !b || typeof b !== "object" || b.key !== key || !(BLOCK_TYPES as readonly string[]).includes(String(b.type))) {
      errors.push(`Block "${key.slice(0, 12)}" isn't valid.`);
      continue;
    }
    const type = b.type as BlockType;
    const cleaned = sanitizeBlockConfig(type, b.config);
    const label = typeof b.label === "string" ? b.label.slice(0, 60) : undefined;
    if (!cleaned.ok) {
      // A draft may hold half-filled blocks; only a publish insists they are complete.
      if (forPublish) errors.push(`${BLOCK_LABELS[type]}: ${cleaned.error}`);
      blocks[key] = { key, type, label, config: (b.config as Record<string, unknown>) ?? {}, ...pointers(b, type) };
    } else blocks[key] = { key, type, label, config: cleaned.config, ...pointers(b, type) };
  }

  const start = typeof input.start === "string" ? input.start : null;
  if (start !== null && !blocks[start]) errors.push("The first block doesn't exist.");
  for (const b of Object.values(blocks)) {
    for (const t of targets(b)) if (!blocks[t]) errors.push(`A block points at one that doesn't exist.`);
  }

  // Every block has exactly one parent and is reachable from the start: a tree, so no loops.
  const parents = new Map<string, number>();
  if (start) parents.set(start, 1);
  for (const b of Object.values(blocks)) for (const t of targets(b)) parents.set(t, (parents.get(t) ?? 0) + 1);
  for (const [k, n] of parents) if (n > 1) errors.push(`Block ${k} is reached from more than one place. Paths can split but not join.`);
  const seen = new Set<string>();
  const walk = (k: string | null | undefined) => {
    if (!k || seen.has(k) || !blocks[k]) return;
    seen.add(k);
    targets(blocks[k]).forEach(walk);
  };
  walk(start);
  for (const k of Object.keys(blocks)) if (!seen.has(k)) errors.push(`A block isn't connected to the workflow.`);

  if (forPublish && !start) errors.push("Add at least one block.");
  return errors.length ? { ok: false, errors: [...new Set(errors)] } : { ok: true, graph: { start, blocks } };
}

function pointers(b: Record<string, unknown>, type: BlockType): Pick<Block, "next" | "yes" | "no"> {
  const p = (v: unknown) => (typeof v === "string" ? v : null);
  return type === "if_else" ? { yes: p(b.yes), no: p(b.no) } : { next: p(b.next) };
}

// ---------------------------------------------------------------------------
// Builder edits
// ---------------------------------------------------------------------------

export type Slot = { parent: string | null; slot: "next" | "yes" | "no" };

export function newKey(graph: Graph): string {
  for (let i = 1; i < 1000; i++) {
    const k = `b${i.toString(36)}`;
    if (!graph.blocks[k]) return k;
  }
  return `b${Date.now().toString(36)}`;
}

/** Add a block at a place on the path. Whatever followed that place continues after the new block. */
export function addBlock(graph: Graph, at: Slot, type: BlockType): { graph: Graph; key: string } {
  const key = newKey(graph);
  const blocks = { ...graph.blocks };
  const old = at.parent === null ? graph.start : (blocks[at.parent]?.[at.slot] ?? null);
  const block: Block = type === "if_else" ? { key, type, config: defaultConfig(type), yes: old, no: null } : { key, type, config: defaultConfig(type), next: old };
  blocks[key] = block;
  if (at.parent === null) return { graph: { start: key, blocks }, key };
  blocks[at.parent] = { ...blocks[at.parent], [at.slot]: key };
  return { graph: { start: graph.start, blocks }, key };
}

function collect(graph: Graph, from: string | null | undefined, into: Set<string>) {
  if (!from || into.has(from) || !graph.blocks[from]) return;
  into.add(from);
  targets(graph.blocks[from]).forEach((t) => collect(graph, t, into));
}

/** Remove a block. The path closes up over it; removing an if/else keeps its "yes" path and drops its "no" path. */
export function removeBlock(graph: Graph, key: string): Graph {
  const target = graph.blocks[key];
  if (!target) return graph;
  const replacement = target.type === "if_else" ? (target.yes ?? null) : (target.next ?? null);
  const dropped = new Set<string>([key]);
  if (target.type === "if_else") collect(graph, target.no, dropped);

  const blocks: Record<string, Block> = {};
  for (const [k, b] of Object.entries(graph.blocks)) {
    if (dropped.has(k)) continue;
    const copy = { ...b };
    for (const s of slotsOf(b)) if (copy[s] === key) copy[s] = replacement;
    blocks[k] = copy;
  }
  return { start: graph.start === key ? replacement : graph.start, blocks };
}

/** Replace one block's settings or label. */
export function updateBlock(graph: Graph, key: string, patch: { config?: Record<string, unknown>; label?: string }): Graph {
  const b = graph.blocks[key];
  if (!b) return graph;
  return { ...graph, blocks: { ...graph.blocks, [key]: { ...b, ...(patch.config ? { config: patch.config } : {}), ...(patch.label !== undefined ? { label: patch.label } : {}) } } };
}

/** Blocks in the order a run would meet them down the first path, for summaries. */
export function blockOrder(graph: Graph): Block[] {
  const out: Block[] = [];
  const walk = (k: string | null | undefined) => {
    if (!k || !graph.blocks[k]) return;
    const b = graph.blocks[k];
    out.push(b);
    if (b.type === "if_else") {
      walk(b.yes);
      walk(b.no);
    } else walk(b.next);
  };
  walk(graph.start);
  return out;
}
