import { NextResponse } from "next/server";

import { runSequencesCron } from "@/lib/sequence-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sequence scheduler tick. Called by an external pinger (cron-job.org) every
 * minute:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/sequences
 *
 * cron-job.org closes the connection after 30s, so the run is budgeted to
 * answer inside that (see DEFAULT_DEADLINE_MS in lib/sequence-runner.ts) and
 * leans on a 1-minute cadence for throughput rather than one long run. Anything
 * left over stays due and the next tick claims it.
 *
 * Query params:
 *   ?dry=1        claim and evaluate due enrollments without sending anything.
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

  try {
    const summary = await runSequencesCron({ dryRun, deadlineMs });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sequence run failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
