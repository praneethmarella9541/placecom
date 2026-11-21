import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { emitEvents } from "@/lib/data-model/events";
import { loadList, loadStage, loadStages, nextPosition } from "@/lib/data-model/lists";
import { createRecord, getRecord, listRecords, loadAttributes, loadObject, loadObjectById, updateRecord } from "@/lib/data-model/records";
import { checkStageRulesV2 } from "@/lib/data-model/rule-engine-bridge";
import { recordStageChange } from "@/lib/data-model/rules-server";
import { validateRecordInput } from "@/lib/data-model/values";
import type { RecordFilter } from "@/lib/data-model/types";
import { conditionsHold } from "./conditions";
import { resolveValue } from "./template";
import type { Block, Condition, FieldSet } from "./types";

/**
 * What each block does when a run reaches it. Every data change goes through the same functions the
 * screens use, so a workflow is bound by the same validation, rules and history as a person, and is
 * recorded as "by workflow" in the event log (which is what the loop guard watches).
 */

export type RunEnv = {
  svc: SupabaseClient;
  org: string;
  ownerId: string;
  workflowId: string;
  runId: string;
  /** What variables read: { trigger: { event, record }, <blockKey>: output } */
  data: Record<string, unknown>;
};

export type BlockResult = {
  output: Record<string, unknown>;
  /** Which way to go next. Default "next"; "stop" ends the run quietly. */
  route?: "next" | "yes" | "no" | "stop";
  /** A delay: how long to wait before the next block. */
  waitMs?: number;
  stopReason?: string;
};

/** A block's failure. `retryable` is for temporary trouble; bad input is not retried. */
export class BlockError extends Error {
  constructor(message: string, public retryable = false) {
    super(message);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const actorOf = (env: RunEnv) => ({ userId: env.ownerId, org: env.org, source: "workflow", workflowId: env.workflowId });

async function recordIdFrom(env: RunEnv, template: unknown): Promise<string> {
  const v = resolveValue(template, env.data);
  if (typeof v !== "string" || !UUID.test(v.trim())) throw new BlockError("There is no record to work on here. The trigger or an earlier block didn't give one.");
  return v.trim();
}

async function liveRecord(env: RunEnv, id: string) {
  const record = await getRecord(env.svc, env.org, id);
  if (!record) throw new BlockError("That record no longer exists.");
  const object = await loadObjectById(env.svc, env.org, record.object_id);
  if (!object) throw new BlockError("That record's object no longer exists.");
  return { record, object };
}

/** A field to set, resolved against the run's data. An empty result means "clear it" on update, "skip" on create. */
function resolveFields(fields: FieldSet[], env: RunEnv): { name?: string; values: Record<string, unknown> } {
  const values: Record<string, unknown> = {};
  let name: string | undefined;
  for (const f of fields) {
    const v = resolveValue(f.value, env.data);
    const empty = v === undefined || v === null || (typeof v === "string" && v.trim() === "");
    if (f.attribute === "name") {
      if (!empty) name = String(v);
    } else values[f.attribute] = empty ? null : v;
  }
  return { name, values };
}

async function memberFrom(env: RunEnv, spec: unknown, recordValues?: Record<string, unknown>): Promise<string | null> {
  let id: string | null = null;
  if (spec === "owner" || spec === "" || spec === undefined) id = env.ownerId;
  else if (typeof spec === "string" && UUID.test(spec)) id = spec;
  else if (typeof spec === "string" && spec.startsWith("field:")) {
    const v = recordValues?.[spec.slice(6)];
    id = typeof v === "string" && UUID.test(v) ? v : null;
  }
  if (!id) return null;
  const { data } = await env.svc.from("profiles").select("id").eq("id", id).or(`id.eq.${env.org},mailbox_owner_id.eq.${env.org}`).maybeSingle();
  return data ? id : null;
}

const summarize = (r: { id: string; name: string }) => ({ id: r.id, name: r.name });

export async function runBlock(block: Block, env: RunEnv): Promise<BlockResult> {
  const c = block.config;
  switch (block.type) {
    case "filter": {
      const ok = conditionsHold(c.match === "any" ? "any" : "all", (c.conditions as Condition[]) ?? [], env.data);
      return ok ? { output: { passed: true } } : { output: { passed: false }, route: "stop", stopReason: "A filter's condition was not met." };
    }

    case "if_else": {
      const ok = conditionsHold(c.match === "any" ? "any" : "all", (c.conditions as Condition[]) ?? [], env.data);
      return { output: { result: ok ? "yes" : "no" }, route: ok ? "yes" : "no" };
    }

    case "delay": {
      const amount = Number(c.amount);
      const unit = c.unit === "minutes" ? 60_000 : c.unit === "hours" ? 3_600_000 : 86_400_000;
      return { output: { waited: `${amount} ${c.unit}` }, waitMs: Math.round(amount * unit) };
    }

    case "update_record": {
      const id = await recordIdFrom(env, c.record);
      const { record, object } = await liveRecord(env, id);
      const attrs = await loadAttributes(env.svc, env.org, object.id);
      const { name, values } = resolveFields((c.fields as FieldSet[]) ?? [], env);
      const r = await updateRecord(env.svc, actorOf(env), object, attrs, record, { name, values });
      if (!r.ok) throw new BlockError(r.errors?.join(" ") ?? r.error, r.status >= 500);
      return { output: { record: summarize(r.record) } };
    }

    case "create_record": {
      const object = await loadObject(env.svc, env.org, String(c.object));
      if (!object) throw new BlockError("The kind of record to create no longer exists.");
      const attrs = await loadAttributes(env.svc, env.org, object.id);
      const { name, values } = resolveFields((c.fields as FieldSet[]) ?? [], env);
      const given = resolveValue(c.name, env.data);
      const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null));
      const r = await createRecord(env.svc, actorOf(env), object, attrs, { name: typeof given === "string" && given.trim() ? given : name, values: clean });
      if (r.ok) return { output: { record: summarize(r.record), created: true } };
      // The email or domain already belongs to a record: use that one instead of making a duplicate.
      if (r.status === 409 && r.existingId) {
        const existing = await getRecord(env.svc, env.org, r.existingId);
        if (existing) return { output: { record: summarize(existing), created: false } };
      }
      throw new BlockError(r.errors?.join(" ") ?? r.error, r.status >= 500);
    }

    case "find_records": {
      const object = await loadObject(env.svc, env.org, String(c.object));
      if (!object) throw new BlockError("The kind of record to look for no longer exists.");
      const attrs = await loadAttributes(env.svc, env.org, object.id);
      const filters: RecordFilter[] = [];
      let q: string | undefined;
      let exactName: string | undefined;
      for (const k of (c.conditions as { attribute: string; op: string; value: string }[]) ?? []) {
        const value = String(resolveValue(k.value, env.data) ?? "");
        if (k.attribute === "name") {
          if (k.op === "contains" || k.op === "eq") q = value;
          if (k.op === "eq") exactName = value.trim().toLowerCase();
        } else filters.push({ attribute: k.attribute, op: k.op as RecordFilter["op"], value: value || undefined });
      }
      const result = await listRecords(env.svc, env.org, object, attrs, { q, filters, sort: "created_at", direction: "asc", pageSize: 20 });
      if (!result.ok) throw new BlockError(result.error, result.status >= 500);
      const rows = exactName ? result.records.filter((r) => r.name.trim().toLowerCase() === exactName) : result.records;
      return { output: { found: exactName ? rows.length : result.total, record: rows[0] ? summarize(rows[0]) : null, records: rows.slice(0, 20).map(summarize) } };
    }

    case "add_to_list": {
      const list = await loadList(env.svc, env.org, String(c.list));
      if (!list) throw new BlockError("That list no longer exists.");
      const recordId = await recordIdFrom(env, c.record);
      const { record } = await liveRecord(env, recordId);
      if (record.object_id !== list.object_id) throw new BlockError("That record can't be added to this list: it is a different kind of record.");

      const { data: have } = await env.svc.from("data_list_entries").select("id").eq("org_owner_id", env.org).eq("list_id", list.id).eq("record_id", recordId).maybeSingle();
      if (have) return { output: { added: false, entry_id: have.id } };

      let stageId: string | null = null;
      if (list.has_stages) {
        const stage = c.stage ? await loadStage(env.svc, env.org, list.id, String(c.stage)) : ((await loadStages(env.svc, env.org, list.id))[0] ?? null);
        stageId = stage?.id ?? null;
      }
      await checkStageRules(env, stageId, record);
      const { data: entry, error } = await env.svc
        .from("data_list_entries")
        .insert({ org_owner_id: env.org, list_id: list.id, record_id: recordId, stage_id: stageId, added_by: env.ownerId, position: await nextPosition(env.svc, "data_list_entries", env.org, list.id, stageId) })
        .select("id")
        .single();
      if (error || !entry) throw new BlockError("Couldn't add the record to the list.", true);
      await recordStageChange(env.svc, env.org, list.id, entry.id as string, null, stageId, env.ownerId);
      await emitEvents(env.svc, [{ org: env.org, type: "list.added", listId: list.id, entryId: entry.id as string, recordId, actor: actorOf(env), payload: { stage_id: stageId } }]);
      return { output: { added: true, entry_id: entry.id } };
    }

    case "update_list_entry": {
      const list = await loadList(env.svc, env.org, String(c.list));
      if (!list) throw new BlockError("That list no longer exists.");
      const recordId = await recordIdFrom(env, c.record);
      const { data: entry } = await env.svc.from("data_list_entries").select("id, stage_id, values").eq("org_owner_id", env.org).eq("list_id", list.id).eq("record_id", recordId).maybeSingle();
      if (!entry) throw new BlockError("That record isn't on the list.");

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      const events = [];
      if (c.stage && c.stage !== entry.stage_id) {
        const stage = await loadStage(env.svc, env.org, list.id, String(c.stage));
        if (!stage) throw new BlockError("That stage no longer exists.");
        const { record } = await liveRecord(env, recordId);
        await checkStageRules(env, stage.id, record);
        patch.stage_id = stage.id;
        patch.stage_entered_at = new Date().toISOString();
        patch.position = await nextPosition(env.svc, "data_list_entries", env.org, list.id, stage.id);
        events.push({ org: env.org, type: "list.entry_updated" as const, listId: list.id, entryId: entry.id as string, recordId, attributeSlug: "stage", oldValue: entry.stage_id, newValue: stage.id, actor: actorOf(env) });
      }
      const fields = (c.fields as FieldSet[]) ?? [];
      if (fields.length) {
        const entryAttrs = await loadAttributes(env.svc, env.org, list.object_id, list.id);
        const { values } = resolveFields(fields, env);
        const valid = validateRecordInput(entryAttrs, { values }, "update");
        if (!valid.ok) throw new BlockError(valid.errors.join(" "));
        const next = { ...(entry.values as Record<string, unknown>), ...valid.values };
        for (const slug of valid.cleared) delete next[slug];
        patch.values = next;
        for (const slug of Object.keys(valid.values)) {
          events.push({ org: env.org, type: "list.entry_updated" as const, listId: list.id, entryId: entry.id as string, recordId, attributeSlug: slug, oldValue: (entry.values as Record<string, unknown>)[slug] ?? null, newValue: valid.values[slug], actor: actorOf(env) });
        }
      }
      const { error } = await env.svc.from("data_list_entries").update(patch).eq("org_owner_id", env.org).eq("id", entry.id as string);
      if (error) throw new BlockError("Couldn't update the list entry.", true);
      if (patch.stage_id) await recordStageChange(env.svc, env.org, list.id, entry.id as string, entry.stage_id as string | null, patch.stage_id as string, env.ownerId);
      await emitEvents(env.svc, events);
      return { output: { entry_id: entry.id, stage_changed: !!patch.stage_id } };
    }

    case "create_note": {
      const recordId = await recordIdFrom(env, c.record);
      await liveRecord(env, recordId);
      const body = String(resolveValue(c.body, env.data) ?? "").trim().slice(0, 10000);
      if (!body) throw new BlockError("The note came out empty.");
      const { data, error } = await env.svc.from("data_notes").insert({ org_owner_id: env.org, record_id: recordId, kind: c.kind ?? "note", body, created_by: env.ownerId }).select("id").single();
      if (error) throw new BlockError("Couldn't save the note.", true);
      return { output: { note_id: data.id } };
    }

    case "create_task": {
      const recordId = await recordIdFrom(env, c.record);
      const { record } = await liveRecord(env, recordId);
      const title = String(resolveValue(c.title, env.data) ?? "").trim().slice(0, 300);
      if (!title) throw new BlockError("The task's title came out empty.");
      const days = c.dueInDays === null || c.dueInDays === undefined ? null : Number(c.dueInDays);
      const due = days === null ? null : new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
      const assignee = await memberFrom(env, c.assignee, record.values);
      const { data, error } = await env.svc.from("data_tasks").insert({ org_owner_id: env.org, record_id: recordId, title, due_date: due, assignee_id: assignee, created_by: env.ownerId }).select("id").single();
      if (error) throw new BlockError("Couldn't save the task.", true);
      return { output: { task_id: data.id, assignee } };
    }

    case "send_notification": {
      let record: { id: string; values: Record<string, unknown> } | null = null;
      const rid = resolveValue("{{trigger.record.id}}", env.data);
      if (typeof rid === "string" && UUID.test(rid)) record = (await getRecord(env.svc, env.org, rid)) ?? null;
      const to = await memberFrom(env, c.to, record?.values);
      if (!to) throw new BlockError("There is nobody to notify: the person chosen isn't on the team.");
      const title = String(resolveValue(c.title, env.data) ?? "").trim().slice(0, 200);
      if (!title) throw new BlockError("The notification's title came out empty.");
      const body = String(resolveValue(c.body, env.data) ?? "").trim().slice(0, 2000);
      const { data, error } = await env.svc
        .from("workflow_notifications")
        .insert({ org_owner_id: env.org, user_id: to, title, body: body || null, link: c.linkToRecord !== false && record ? `/data/${record.id}` : null, workflow_id: env.workflowId, run_id: env.runId })
        .select("id")
        .single();
      if (error) throw new BlockError("Couldn't send the notification.", true);
      return { output: { notification_id: data.id, to } };
    }
  }
}

/** Stage rules ("a deal's value is required to enter Won") apply to workflows exactly as to people. */
async function checkStageRules(env: RunEnv, stageId: string | null, record: { object_id: string; name: string; values: Record<string, unknown> }) {
  if (!stageId) return;
  const attrs = await loadAttributes(env.svc, env.org, record.object_id);
  const problems = await checkStageRulesV2(env.svc, env.org, stageId, attrs, record.values, record.name, env.ownerId);
  if (problems.length) throw new BlockError(problems.join(" "));
}
