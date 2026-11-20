import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { loadList, loadStages } from "@/lib/data-model/lists";
import { listDenied } from "@/lib/data-model/route-helpers";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * GET /api/data/lists/[id]/report
 * For each stage: how many cards are in it now, how long they have been there on average, how many
 * are past the stage's target time, and how many cards have EVER reached it (the funnel).
 *
 * "Reached" comes from stage history, which is written from the day 0093 was applied. A card with no
 * history (it was on the board before then) counts only for the stage it is in now, so the funnel
 * for older cards understates earlier stages until they move.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const list = await loadList(svc, orgOwnerId, (await props.params).id);
  if (!list) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const denied = await listDenied(auth.ctx, list, "read");
  if (denied) return denied;
  const stages = await loadStages(svc, orgOwnerId, list.id);

  const [entries, history] = await Promise.all([
    fetchAllRows<{ id: string; stage_id: string | null; stage_entered_at: string }>((from, to) =>
      svc.from("data_list_entries").select("id, stage_id, stage_entered_at").eq("org_owner_id", orgOwnerId).eq("list_id", list.id).order("id", { ascending: true }).range(from, to)
    ),
    fetchAllRows<{ id: number; entry_id: string; to_stage_id: string | null }>((from, to) =>
      svc.from("data_list_entry_history").select("id, entry_id, to_stage_id").eq("org_owner_id", orgOwnerId).eq("list_id", list.id).order("id", { ascending: true }).range(from, to)
    ),
  ]);
  if (entries.error) return NextResponse.json({ error: dbErrorMessage({ message: String(entries.error) }) }, { status: 500 });
  // A database without 0093 has no history table: the funnel falls back to current positions.
  const hist = history.error ? [] : (history.data ?? []);
  const rows = entries.data ?? [];

  const reached = new Map<string, Set<string>>();
  const withHistory = new Set<string>();
  for (const h of hist) {
    withHistory.add(h.entry_id);
    if (!h.to_stage_id) continue;
    (reached.get(h.to_stage_id) ?? reached.set(h.to_stage_id, new Set()).get(h.to_stage_id)!).add(h.entry_id);
  }
  for (const e of rows) {
    if (!e.stage_id || withHistory.has(e.id)) continue;
    (reached.get(e.stage_id) ?? reached.set(e.stage_id, new Set()).get(e.stage_id)!).add(e.id);
  }

  const now = Date.now();
  const first = reached.get(stages[0]?.id ?? "")?.size ?? 0;
  return NextResponse.json({
    list: { id: list.id, name: list.name, has_stages: list.has_stages },
    total: rows.length,
    unstaged: rows.filter((e) => !e.stage_id).length,
    stages: stages.map((s) => {
      const here = rows.filter((e) => e.stage_id === s.id);
      const days = here.map((e) => Math.max(0, (now - Date.parse(e.stage_entered_at)) / 86_400_000));
      return {
        id: s.id,
        name: s.name,
        color: s.color,
        is_closed: s.is_closed,
        target_days: s.target_days,
        current: here.length,
        avg_days_in_stage: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null,
        late: s.target_days ? days.filter((d) => d > s.target_days!).length : 0,
        reached: reached.get(s.id)?.size ?? 0,
        reached_pct_of_first: first ? Math.round(((reached.get(s.id)?.size ?? 0) / first) * 100) : null,
      };
    }),
  });
}
