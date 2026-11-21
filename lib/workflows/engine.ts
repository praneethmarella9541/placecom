import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase-service";
import { getRecord, loadObjectById } from "@/lib/data-model/records";
import { BlockError, runBlock, type BlockResult, type RunEnv } from "./blocks";
import { nextFireAt, type ScheduleConfig } from "./schedule";
import { triggerMatches } from "./triggers";
import type { Block, Graph, Trigger, WorkflowEvent } from "./types";
import { LIMITS } from "./types";

/**
 * The worker (docs/workflows-v1.md, section 6). One pass, `runWorkflowTick`:
 *   1. turn new events in the log into runs (the matcher),
 *   2. start schedule-triggered workflows that are due,
 *   3. claim due runs with a lease and run their blocks until a delay, the end, or the time budget.
 *
 * It follows the sequence sender's pattern: a run is claimed by a conditional UPDATE that re-checks
 * the lease, so two workers can never hold one run, and a run whose worker died is picked up again
 * once its lease goes stale. (workflow_id, event_id) is unique, so an event can never start the same
 * workflow twice however often it is looked at.
 */

const LEASE_SECONDS = 300;
const DEFAULT_BUDGET_MS = 50_000;

export type TickSummary = {
  eventsProcessed: number;
  runsStarted: number;
  scheduled: number;
  claimed: number;
  succeeded: number;
  stopped: number;
  waiting: number;
  failed: number;
  durationMs: number;
};

type Wf = { id: string; org_owner_id: string; name: string; owner_id: string | null; live_version_id: string | null; status: string };
type Version = { id: string; graph: Graph; trigger_type: string | null; trigger_config: Record<string, unknown> };
type RunRow = {
  id: string;
  org_owner_id: string;
  workflow_id: string;
  version_id: string;
  event_id: number | null;
  record_id: string | null;
  status: string;
  cursor: { blockKey?: string | null; steps?: number; tries?: number };
  context: Record<string, unknown>;
  attempt_no: number;
};

let tickActive = false;

export async function runWorkflowTick(options: { budgetMs?: number } = {}): Promise<TickSummary> {
  const started = Date.now();
  const summary: TickSummary = { eventsProcessed: 0, runsStarted: 0, scheduled: 0, claimed: 0, succeeded: 0, stopped: 0, waiting: 0, failed: 0, durationMs: 0 };
  // One worker per server instance at a time; another instance is kept out by the run leases.
  if (tickActive) return summary;
  tickActive = true;
  try {
    const budget = Math.min(240_000, Math.max(5_000, options.budgetMs ?? DEFAULT_BUDGET_MS));
    const deadline = started + budget;
    const svc = createServiceSupabase();

    await processEvents(svc, summary);
    await fireSchedules(svc, summary);

    while (Date.now() < deadline) {
      const runs = await claimRuns(svc, 10);
      if (!runs.length) break;
      summary.claimed += runs.length;
      for (const run of runs) {
        if (Date.now() >= deadline) {
          await release(svc, run, { status: "waiting", next_run_at: new Date().toISOString() });
          continue;
        }
        await executeRun(svc, run, deadline, summary);
      }
    }
  } finally {
    tickActive = false;
    summary.durationMs = Date.now() - started;
  }
  return summary;
}

// ---------------------------------------------------------------------------
// 1. Events -> runs
// ---------------------------------------------------------------------------

type Live = { wf: Wf; trigger: Trigger };

async function loadLive(svc: SupabaseClient, org: string): Promise<Live[]> {
  const { data: wfs } = await svc.from("workflows").select("id, org_owner_id, name, owner_id, live_version_id, status").eq("org_owner_id", org).eq("status", "live").is("deleted_at", null);
  const ids = (wfs ?? []).map((w) => w.live_version_id).filter((x): x is string => !!x);
  if (!ids.length) return [];
  const { data: versions } = await svc.from("workflow_versions").select("id, trigger_type, trigger_config").in("id", ids);
  const by = new Map((versions ?? []).map((v) => [v.id as string, v]));
  return (wfs as Wf[]).flatMap((wf) => {
    const v = by.get(wf.live_version_id ?? "");
    return v ? [{ wf, trigger: { type: v.trigger_type as Trigger["type"], config: (v.trigger_config as Record<string, unknown>) ?? {} } }] : [];
  });
}

async function processEvents(svc: SupabaseClient, summary: TickSummary): Promise<void> {
  const { data: events, error } = await svc.from("workflow_events").select("*").is("processed_at", null).order("id", { ascending: true }).limit(200);
  // No table yet (0094 not applied) or nothing new.
  if (error || !events?.length) return;

  const liveByOrg = new Map<string, Live[]>();
  const runsToday = new Map<string, number>();
  for (const ev of events as WorkflowEvent[]) {
    let live = liveByOrg.get(ev.org_owner_id);
    if (!live) {
      live = await loadLive(svc, ev.org_owner_id);
      liveByOrg.set(ev.org_owner_id, live);
    }
    for (const l of [...live]) {
      if (!triggerMatches(l.trigger, ev)) continue;
      const started = await startRun(svc, l, ev, runsToday, live);
      if (started) summary.runsStarted++;
    }
  }

  const ids = (events as WorkflowEvent[]).map((e) => e.id);
  summary.eventsProcessed += ids.length;
  for (let i = 0; i < ids.length; i += 100) await svc.from("workflow_events").update({ processed_at: new Date().toISOString() }).in("id", ids.slice(i, i + 100));
}

async function notify(svc: SupabaseClient, wf: Wf, title: string, body: string, link?: string): Promise<void> {
  if (!wf.owner_id) return;
  // One failure notice per workflow per hour, however many runs fail: 500 failures send one message.
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await svc.from("workflow_notifications").select("id", { count: "exact", head: true }).eq("workflow_id", wf.id).eq("title", title).gte("created_at", since);
  if ((count ?? 0) > 0) return;
  await svc.from("workflow_notifications").insert({ org_owner_id: wf.org_owner_id, user_id: wf.owner_id, title, body: body.slice(0, 2000), link: link ?? `/workflows/${wf.id}`, workflow_id: wf.id });
}

async function startRun(svc: SupabaseClient, l: Live, ev: WorkflowEvent | null, runsToday: Map<string, number>, live: Live[]): Promise<boolean> {
  const { wf } = l;

  // Loop guard: a workflow that keeps re-triggering itself on one record is switched off.
  if (ev?.record_id) {
    const since = new Date(Date.now() - LIMITS.loopWindowSeconds * 1000).toISOString();
    const { count } = await svc.from("workflow_runs").select("id", { count: "exact", head: true }).eq("workflow_id", wf.id).eq("record_id", ev.record_id).gte("created_at", since);
    if ((count ?? 0) >= LIMITS.loopMaxRuns) {
      const reason = `Loop guard: it started ${LIMITS.loopMaxRuns} times on one record within ${LIMITS.loopWindowSeconds} seconds, so it was turned off. A workflow that changes the field it listens to does this.`;
      await svc.from("workflows").update({ status: "off", flagged_at: new Date().toISOString(), flag_reason: reason, updated_at: new Date().toISOString() }).eq("id", wf.id);
      await notify(svc, wf, `Workflow "${wf.name}" was turned off`, reason);
      live.splice(live.indexOf(l), 1);
      return false;
    }
  }

  // Safety limit per organisation per day.
  let today = runsToday.get(wf.org_owner_id);
  if (today === undefined) {
    const { count } = await svc.from("workflow_runs").select("id", { count: "exact", head: true }).eq("org_owner_id", wf.org_owner_id).gte("created_at", new Date(Date.now() - 86_400_000).toISOString());
    today = count ?? 0;
  }
  if (today >= LIMITS.runsPerDay) {
    runsToday.set(wf.org_owner_id, today);
    await svc.from("workflows").update({ flagged_at: new Date().toISOString(), flag_reason: `The daily limit of ${LIMITS.runsPerDay} runs was reached, so new runs are paused until it eases.` }).eq("id", wf.id);
    await notify(svc, wf, `Workflow runs paused`, `Your workspace reached ${LIMITS.runsPerDay} workflow runs in 24 hours. New runs are paused until the count drops.`);
    return false;
  }

  const { error } = await svc.from("workflow_runs").insert({
    org_owner_id: wf.org_owner_id,
    workflow_id: wf.id,
    version_id: wf.live_version_id,
    event_id: ev?.id ?? null,
    record_id: ev?.record_id ?? null,
    status: "queued",
    context: { trigger: { event: ev ? { id: ev.id, type: ev.type, attribute: ev.attribute_slug, old_value: ev.old_value, new_value: ev.new_value, actor_kind: ev.actor_kind, source: ev.source, entry_id: ev.entry_id, list_id: ev.list_id, ...ev.payload } : { type: "schedule", fired_at: new Date().toISOString() } } },
  });
  // The unique key says this event already started this workflow: nothing more to do.
  if (error) {
    if (error.code !== "23505") console.error("[workflows] couldn't start a run:", error.code, error.message);
    return false;
  }
  runsToday.set(wf.org_owner_id, today + 1);
  return true;
}

// ---------------------------------------------------------------------------
// 2. Schedules
// ---------------------------------------------------------------------------

async function fireSchedules(svc: SupabaseClient, summary: TickSummary): Promise<void> {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await svc.from("workflows").select("id, org_owner_id, name, owner_id, live_version_id, status, next_fire_at").eq("status", "live").is("deleted_at", null).not("next_fire_at", "is", null).lte("next_fire_at", nowIso).limit(50);
  if (error || !due?.length) return;

  const runsToday = new Map<string, number>();
  for (const wf of due as (Wf & { next_fire_at: string })[]) {
    const { data: v } = await svc.from("workflow_versions").select("trigger_type, trigger_config").eq("id", wf.live_version_id).maybeSingle();
    if (!v || v.trigger_type !== "schedule") {
      await svc.from("workflows").update({ next_fire_at: null }).eq("id", wf.id);
      continue;
    }
    const next = nextFireAt(v.trigger_config as ScheduleConfig, new Date());
    // Claim this firing: only the worker whose update still sees the old time starts the run.
    const { data: claimed } = await svc.from("workflows").update({ next_fire_at: next.toISOString() }).eq("id", wf.id).eq("next_fire_at", wf.next_fire_at).select("id").maybeSingle();
    if (!claimed) continue;
    const l: Live = { wf, trigger: { type: "schedule", config: v.trigger_config as Record<string, unknown> } };
    if (await startRun(svc, l, null, runsToday, [l])) summary.scheduled++;
  }
}

// ---------------------------------------------------------------------------
// 3. Runs
// ---------------------------------------------------------------------------

async function claimRuns(svc: SupabaseClient, limit: number): Promise<RunRow[]> {
  const nowIso = new Date().toISOString();
  const stale = new Date(Date.now() - LEASE_SECONDS * 1000).toISOString();
  const claimable = `claimed_at.is.null,claimed_at.lt.${stale}`;
  const { data: candidates, error } = await svc.from("workflow_runs").select("id").in("status", ["queued", "waiting", "running"]).lte("next_run_at", nowIso).or(claimable).order("next_run_at", { ascending: true }).limit(limit);
  if (error || !candidates?.length) return [];

  const claimed: RunRow[] = [];
  for (const c of candidates) {
    // The conditional update re-checks the lease, so a run another worker just took comes back empty.
    const { data } = await svc
      .from("workflow_runs")
      .update({ status: "running", claimed_at: nowIso, claim_token: randomUUID() })
      .eq("id", c.id)
      .in("status", ["queued", "waiting", "running"])
      .or(claimable)
      .select("*")
      .maybeSingle();
    if (data) claimed.push(data as RunRow);
  }
  return claimed;
}

async function release(svc: SupabaseClient, run: RunRow & { claim_token?: string }, patch: Record<string, unknown>): Promise<void> {
  await svc.from("workflow_runs").update({ ...patch, claimed_at: null, claim_token: null }).eq("id", run.id);
}

async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BlockError("The block took too long and was stopped.", true)), ms);
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const backoffMs = (tries: number) => (tries <= 1 ? 60_000 : 5 * 60_000);

async function executeRun(svc: SupabaseClient, run: RunRow, deadline: number, summary: TickSummary): Promise<void> {
  const [{ data: wfRow }, { data: verRow }] = await Promise.all([
    svc.from("workflows").select("id, org_owner_id, name, owner_id, live_version_id, status, deleted_at").eq("id", run.workflow_id).maybeSingle(),
    svc.from("workflow_versions").select("id, graph, trigger_type, trigger_config").eq("id", run.version_id).maybeSingle(),
  ]);
  const wf = wfRow as (Wf & { deleted_at: string | null }) | null;
  const ver = verRow as Version | null;

  const end = async (status: "succeeded" | "failed" | "cancelled", extra: Record<string, unknown> = {}) => {
    await release(svc, run, { status, finished_at: new Date().toISOString(), ...extra });
    if (status === "succeeded") summary[extra.outcome ? "stopped" : "succeeded"]++;
    if (status === "failed") summary.failed++;
  };

  if (!wf || !ver || wf.deleted_at) return end("cancelled", { error: "The workflow was deleted." });
  if (!wf.owner_id) return end("failed", { error: "The workflow has no owner. Give it to someone and retry." });

  const graph = ver.graph;
  const data: Record<string, unknown> = { ...(run.context ?? {}) };
  const trigger = (data.trigger as Record<string, unknown>) ?? {};
  data.trigger = trigger;
  let key: string | null | undefined = run.cursor.blockKey === undefined ? graph.start : run.cursor.blockKey;
  let steps = run.cursor.steps ?? 0;
  let tries = run.cursor.tries ?? 0;

  const persistable = () => {
    const copy = { ...data, trigger: { ...(data.trigger as Record<string, unknown>) } };
    delete (copy.trigger as Record<string, unknown>).record; // read fresh at every block
    return copy;
  };

  for (let ran = 0; ran < LIMITS.maxStepsPerTick; ran++) {
    if (!key) return end("succeeded");
    if (Date.now() >= deadline) return release(svc, run, { status: "waiting", next_run_at: new Date().toISOString(), cursor: { blockKey: key, steps, tries }, context: persistable() });

    // Cancelled while it waited?
    const { data: current } = await svc.from("workflow_runs").select("status").eq("id", run.id).maybeSingle();
    if (current?.status === "cancelled") return release(svc, run, {});

    const block: Block | undefined = graph.blocks[key];
    if (!block) return end("failed", { error: "A block in this version is missing." });

    // The record that started the run, as it is now.
    if (run.record_id) {
      const rec = await getRecord(svc, run.org_owner_id, run.record_id);
      const obj = rec ? await loadObjectById(svc, run.org_owner_id, rec.object_id) : null;
      trigger.record = rec ? { id: rec.id, name: rec.name, object: obj?.slug ?? null, values: rec.values } : null;
    }

    const env: RunEnv = { svc, org: run.org_owner_id, ownerId: wf.owner_id, workflowId: wf.id, runId: run.id, data };
    const startedAt = new Date().toISOString();
    try {
      const result: BlockResult = await withTimeout(runBlock(block, env), LIMITS.blockTimeoutMs);
      await svc.from("workflow_run_steps").insert({ org_owner_id: run.org_owner_id, run_id: run.id, block_key: block.key, block_type: block.type, attempt: run.attempt_no, status: result.route === "stop" ? "stopped" : "succeeded", input: block.config, output: result.output, started_at: startedAt, finished_at: new Date().toISOString() });
      data[block.key] = result.output;
      steps++;
      tries = 0;

      if (result.route === "stop") return end("succeeded", { outcome: result.stopReason ?? "Stopped.", cursor: { blockKey: null, steps, tries: 0 }, context: persistable() });

      const nextKey: string | null = result.route === "yes" ? (block.yes ?? null) : result.route === "no" ? (block.no ?? null) : (block.next ?? null);
      if (result.waitMs !== undefined) {
        summary.waiting++;
        return release(svc, run, { status: "waiting", next_run_at: new Date(Date.now() + result.waitMs).toISOString(), cursor: { blockKey: nextKey, steps, tries: 0 }, context: persistable() });
      }
      key = nextKey;
      await svc.from("workflow_runs").update({ cursor: { blockKey: key, steps, tries: 0 }, context: persistable() }).eq("id", run.id);
    } catch (e) {
      const known = e instanceof BlockError;
      const message = known ? e.message : "Something unexpected went wrong in this block.";
      if (!known) console.error("[workflows] block crashed:", block.type, e);
      await svc.from("workflow_run_steps").insert({ org_owner_id: run.org_owner_id, run_id: run.id, block_key: block.key, block_type: block.type, attempt: run.attempt_no, status: "failed", input: block.config, error: message, started_at: startedAt, finished_at: new Date().toISOString() });

      const retryable = known ? e.retryable : true;
      if (retryable && tries + 1 < LIMITS.maxAttempts) {
        tries++;
        summary.waiting++;
        return release(svc, run, { status: "waiting", next_run_at: new Date(Date.now() + backoffMs(tries)).toISOString(), cursor: { blockKey: key, steps, tries }, context: persistable(), error: message });
      }
      await end("failed", { error: message, cursor: { blockKey: key, steps, tries }, context: persistable() });
      await notify(svc, wf, `Workflow "${wf.name}" failed`, message, `/workflows/${wf.id}?run=${run.id}`);
      return;
    }
  }
  // Ran a lot of blocks in one pass: hand it back so other runs get a turn.
  await release(svc, run, { status: "waiting", next_run_at: new Date().toISOString(), cursor: { blockKey: key, steps, tries }, context: persistable() });
}
