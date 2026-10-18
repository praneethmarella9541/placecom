import { NextResponse, after } from "next/server";

import { hasDueSequenceWork, sequenceSenderRecentlyActive } from "@/lib/sequence-due-check";
import { createServiceSupabase } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * How long a tick keeps sending in the background after it has answered. Under the route's 300s
 * limit; the cron-job.org 30s limit applies only to the answer, which comes back immediately.
 */
const BACKGROUND_BUDGET_MS = 240_000;

/** One sender at a time per server instance; across instances see sequenceSenderRecentlyActive. */
let backgroundRunActive = false;

/**
 * Sequence scheduler tick. Called by an external pinger (cron-job.org) every
 * minute:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/sequences
 *
 * cron-job.org closes the connection after 30s, so the tick answers at once
 * ({ started: true }) and carries on sending in the background for up to
 * BACKGROUND_BUDGET_MS, which the 30s limit does not touch. A tick with nothing
 * due answers { idle: true } without loading the sender at all. Anything left
 * over stays due and the next tick claims it.
 *
 * Query params:
 *   ?dry=1        claim and evaluate due enrollments without sending anything
 *                 (answers with the finished summary).
 *   ?wait=1       run in the request and answer with the summary — for testing by hand.
 *   ?budgetMs=N   override the work budget (clamped to 5s..240s) for a pinger
 *                 that tolerates a longer response than cron-job.org does.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();

  // Fail closed: a missing secret must never mean "open to the world".
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if ((request.headers.get("authorization") ?? "") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = new URL(request.url).searchParams;
  const dryRun = params.get("dry") === "1";
  // Ignore a non-numeric override rather than passing NaN through as a budget.
  const budget = Number(params.get("budgetMs"));
  const deadlineMs = Number.isFinite(budget) && budget > 0 ? budget : undefined;

  // Self-reported build identity. Vercel bakes these into every deployment's
  // env at build time — surfacing them here answers "which commit actually
  // produced this response" directly from the response itself, rather than
  // from a dashboard label or a "Redeploy" entry that can silently diverge
  // from what's really running behind a given domain.
  const build = {
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? null,
    vercelEnv: process.env.VERCEL_ENV ?? null,
  };

  try {
    // Most ticks find nothing due. Ask first, with one small query, and only then load the sender
    // (a heavy import) and run it — an empty tick costs a fraction of a full one.
    const svc = createServiceSupabase();
    if (!(await hasDueSequenceWork(svc))) {
      return NextResponse.json({
        ok: true,
        idle: true,
        dryRun,
        claimed: 0,
        sent: 0,
        skipped: 0,
        replied: 0,
        bounced: 0,
        failed: 0,
        mailboxes: 0,
        durationMs: 0,
        build,
      });
    }
    const { runSequencesCron } = await import("@/lib/sequence-runner");

    // A dry run, or ?wait=1, answers with the finished summary (for testing by hand).
    if (dryRun || params.get("wait") === "1") {
      const summary = await runSequencesCron({ dryRun, deadlineMs });
      return NextResponse.json({ ...summary, build });
    }

    // The normal tick answers at once and keeps sending after the response, so the pinger's
    // 30-second limit no longer caps how much one tick can send.
    if (backgroundRunActive || (await sequenceSenderRecentlyActive(svc))) {
      return NextResponse.json({ ok: true, busy: true, build });
    }
    backgroundRunActive = true;
    after(async () => {
      try {
        const summary = await runSequencesCron({ deadlineMs: deadlineMs ?? BACKGROUND_BUDGET_MS });
        console.log("[cron/sequences]", JSON.stringify(summary));
      } catch (err) {
        console.error("[cron/sequences] background run failed", err);
      } finally {
        backgroundRunActive = false;
      }
    });
    return NextResponse.json({ ok: true, started: true, build });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sequence run failed";
    return NextResponse.json({ ok: false, error: message, build }, { status: 500 });
  }
}
