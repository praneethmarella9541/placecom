/**
 * Workflows: the shapes shared by the builder, the API and the engine. Pure types and constants.
 * A workflow is one trigger plus a tree of blocks (docs/workflows-v1.md).
 */

export const BLOCK_TYPES = [
  "filter",
  "if_else",
  "delay",
  "update_record",
  "create_record",
  "find_records",
  "add_to_list",
  "update_list_entry",
  "create_note",
  "create_task",
  "send_notification",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const TRIGGER_TYPES = ["record_created", "record_updated", "attribute_changed", "list_added", "list_entry_updated", "manual", "schedule"] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

export type ConditionOp = "eq" | "neq" | "contains" | "not_contains" | "gt" | "lt" | "empty" | "not_empty";
export type Condition = { left: string; op: ConditionOp; right?: string };
export type FieldSet = { attribute: string; value: string };

/** One block. `next` continues the path; an if/else uses `yes` and `no` instead. A null pointer ends the path. */
export type Block = {
  key: string;
  type: BlockType;
  /** What the person calls it on the canvas; optional. */
  label?: string;
  config: Record<string, unknown>;
  next?: string | null;
  yes?: string | null;
  no?: string | null;
};

export type Graph = { start: string | null; blocks: Record<string, Block> };
export const EMPTY_GRAPH: Graph = { start: null, blocks: {} };

export type Trigger = { type: TriggerType | null; config: Record<string, unknown> };

/** A row of the event log, as the matcher and the engine read it. */
export type WorkflowEvent = {
  id: number;
  org_owner_id: string;
  type: "record.created" | "record.updated" | "attribute.changed" | "list.added" | "list.entry_updated" | "manual";
  object_slug: string | null;
  record_id: string | null;
  list_id: string | null;
  entry_id: string | null;
  attribute_slug: string | null;
  old_value: unknown;
  new_value: unknown;
  actor_kind: "user" | "workflow" | "system";
  actor_id: string | null;
  source: string | null;
  payload: Record<string, unknown>;
};

export type RunStatus = "queued" | "running" | "waiting" | "succeeded" | "failed" | "cancelled";

/** Limits that keep one workflow from running away. Numbers to be tuned on real use. */
export const LIMITS = {
  maxBlocks: 40,
  /** Blocks one tick will run for one run before handing it back (a guard, not a business rule). */
  maxStepsPerTick: 25,
  blockTimeoutMs: 60_000,
  maxAttempts: 3,
  /** Loop guard: this many runs of one workflow on one record inside the window means a loop. */
  loopMaxRuns: 5,
  loopWindowSeconds: 60,
  /** Runs one organisation may start in 24 hours. */
  runsPerDay: 5000,
  maxDelayDays: 365,
} as const;
