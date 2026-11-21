import { NextResponse, after } from "next/server";
import { secretsMatch } from "@/lib/timing-safe";
import { createServiceSupabase } from "@/lib/supabase-service";
import { loadModuleConfig } from "@/lib/module-config-store";
import { isModuleEnabled } from "@/lib/module-config";
import { runWorkflowTick } from "@/lib/workflows/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const BACKGROUND_BUDGET_MS = 240_000;

/**
 * Workflow worker tick. Call it every minute, like the sequence tick:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/workflows
 *
 * It answers at once ({ started: true }) and carries on in the background, so a pinger with a short
 * time limit is fine. ?wait=1 runs in the request and answers with the summary, for testing by hand;
 * ?budgetMs=N overrides the time budget (5s to 240s). With the Workflows module off it does nothing.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!secretsMatch(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceSupabase();
  if (!isModuleEnabled(await loadModuleConfig(svc), "workflows")) return NextResponse.json({ ok: true, idle: true, reason: "module off" });

  const params = new URL(request.url).searchParams;
  const budget = Number(params.get("budgetMs"));
  const budgetMs = Number.isFinite(budget) && budget > 0 ? budget : BACKGROUND_BUDGET_MS;

  if (params.get("wait") === "1") return NextResponse.json({ ok: true, ...(await runWorkflowTick({ budgetMs })) });
  after(async () => {
    try {
      await runWorkflowTick({ budgetMs });
    } catch (e) {
      console.error("[workflows] tick failed:", e);
    }
  });
  return NextResponse.json({ ok: true, started: true });
}
