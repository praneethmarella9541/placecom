import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadList, loadStage } from "@/lib/data-model/lists";
import { loadObject } from "@/lib/data-model/records";
import { BLOCK_LABELS } from "./graph";
import type { Graph, Trigger } from "./types";

/**
 * Before a publish: do the objects, lists and stages the workflow names still exist? A workflow
 * that points at something deleted would only fail on its first run; this says so up front.
 */
export async function referenceProblems(svc: SupabaseClient, org: string, trigger: Trigger, graph: Graph): Promise<string[]> {
  const problems: string[] = [];
  const objects = new Map<string, boolean>();
  const lists = new Map<string, Awaited<ReturnType<typeof loadList>>>();

  const hasObject = async (slug: unknown) => {
    const s = String(slug ?? "");
    if (!objects.has(s)) objects.set(s, !!(await loadObject(svc, org, s)));
    return objects.get(s)!;
  };
  const getList = async (id: unknown) => {
    const s = String(id ?? "");
    if (!lists.has(s)) lists.set(s, await loadList(svc, org, s));
    return lists.get(s) ?? null;
  };

  const c = trigger.config;
  if (["record_created", "record_updated", "attribute_changed", "manual", "rule_matched"].includes(trigger.type ?? "") && !(await hasObject(c.object))) problems.push("The trigger's object no longer exists.");
  if (["list_added", "list_entry_updated"].includes(trigger.type ?? "") && !(await getList(c.list))) problems.push("The trigger's list no longer exists.");

  for (const b of Object.values(graph.blocks)) {
    const name = BLOCK_LABELS[b.type];
    if ((b.type === "create_record" || b.type === "find_records") && !(await hasObject(b.config.object))) problems.push(`${name}: the object no longer exists.`);
    if (b.type === "add_to_list" || b.type === "update_list_entry") {
      const list = await getList(b.config.list);
      if (!list) problems.push(`${name}: the list no longer exists.`);
      else if (b.config.stage && !(await loadStage(svc, org, list.id, String(b.config.stage)))) problems.push(`${name}: the stage no longer exists.`);
    }
  }
  return problems;
}
