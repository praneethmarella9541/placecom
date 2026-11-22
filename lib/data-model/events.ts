import "server-only";

import { after } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase-service";
import { loadModuleConfig } from "@/lib/module-config-store";
import { isModuleEnabled } from "@/lib/module-config";

/**
 * The event log. Every change to the data model that a workflow can react to is written here first
 * (docs/workflows-v1.md); a worker later turns events into runs. Writing is best effort and never
 * blocks or fails the change it describes: a database without migration 0094 simply has no log.
 */

export type EventInput = {
  org: string;
  type: "record.created" | "record.updated" | "attribute.changed" | "list.added" | "list.entry_updated" | "rule.matched" | "manual";
  objectSlug?: string | null;
  recordId?: string | null;
  listId?: string | null;
  entryId?: string | null;
  attributeSlug?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  actor: { userId: string; source?: string; workflowId?: string };
  payload?: Record<string, unknown>;
};

export async function emitEvents(svc: SupabaseClient, events: EventInput[]): Promise<void> {
  if (!events.length) return;
  const rows = events.map((e) => ({
    org_owner_id: e.org,
    type: e.type,
    object_slug: e.objectSlug ?? null,
    record_id: e.recordId ?? null,
    list_id: e.listId ?? null,
    entry_id: e.entryId ?? null,
    attribute_slug: e.attributeSlug ?? null,
    old_value: e.oldValue === undefined ? null : e.oldValue,
    new_value: e.newValue === undefined ? null : e.newValue,
    actor_kind: e.actor.source === "workflow" ? "workflow" : e.actor.source === "system" ? "system" : "user",
    actor_id: e.actor.userId,
    source: e.actor.source ?? "app",
    payload: { ...(e.payload ?? {}), ...(e.actor.workflowId ? { workflow_id: e.actor.workflowId } : {}) },
  }));
  const { error } = await svc.from("workflow_events").insert(rows);
  if (error) {
    if (!/workflow_events|schema cache/.test(error.message)) console.error("[workflows] couldn't write events:", error.code, error.message);
    return;
  }
  kickWorkflows(events[0].org);
}

// --- start the worker soon after an event, instead of waiting for the next scheduled tick --------

let lastKick = 0;
const liveCache = new Map<string, { at: number; live: boolean }>();

/**
 * Ask for a worker pass shortly after events are written. It only does anything if the workflows
 * module is on and the org has a live workflow, and passes are spaced at least 5 seconds apart per
 * server instance. The scheduled tick still runs regardless; this only shortens the wait.
 */
export function kickWorkflows(org: string): void {
  const now = Date.now();
  if (now - lastKick < 5000) return;
  lastKick = now;
  try {
    after(async () => {
      const svc = createServiceSupabase();
      if (!isModuleEnabled(await loadModuleConfig(svc), "workflows")) return;
      const hit = liveCache.get(org);
      let live = hit && now - hit.at < 15_000 ? hit.live : undefined;
      if (live === undefined) {
        const { count } = await svc.from("workflows").select("id", { count: "exact", head: true }).eq("org_owner_id", org).eq("status", "live").is("deleted_at", null);
        live = (count ?? 0) > 0;
        liveCache.set(org, { at: now, live });
      }
      if (!live) return;
      const { runWorkflowTick } = await import("@/lib/workflows/engine");
      await runWorkflowTick({ budgetMs: 25_000 });
    });
  } catch {
    // Not inside a request (a script, a test): the scheduled tick will pick the events up.
  }
}
