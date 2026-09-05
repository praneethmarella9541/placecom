import { NextResponse } from "next/server";

import { runSequencesCron } from "@/lib/sequence-runner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Sequence scheduler tick. Called by an external pinger (GitHub Actions /
 * cron-job.org) roughly every 10 minutes:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<app>/api/cron/sequences
 *
 * Pass ?dry=1 to claim and evaluate due enrollments without sending anything.
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

  const dryRun = new URL(request.url).searchParams.get("dry") === "1";

  try {
    const summary = await runSequencesCron({ dryRun });
    return NextResponse.json(summary);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Sequence run failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
