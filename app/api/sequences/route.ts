import { NextResponse } from "next/server";

import {
  countEnrollmentsBySequence,
  getSequenceContext,
  isErrorResponse,
} from "@/lib/sequence-server";
import type { SequenceListItem, SequenceStatus } from "@/lib/sequence-types";
import { emptyEnrollmentCounts } from "@/lib/sequence-types";

export const runtime = "nodejs";

type SequenceListRow = {
  id: string;
  name: string;
  description: string | null;
  status: SequenceStatus;
  published_at: string | null;
  updated_at: string;
  origin: string | null;
  scheduled_for: string | null;
};

/** Emails this far past due mean the scheduler is not running (a working one defers or sends them). */
const OVERDUE_MINUTES = 10;

/** GET /api/sequences — the caller's own sequences (an admin sees every one in the mailbox). */
export async function GET(request: Request) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  let listQuery = ctx.svc
    .from("sequences")
    .select("id, name, description, status, published_at, updated_at, origin, scheduled_for")
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .neq("status", "archived");
  if (!ctx.isAdmin) listQuery = listQuery.eq("created_by", ctx.userId);
  const { data, error } = await listQuery.order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as SequenceListRow[];
  const ids = rows.map((r) => r.id);

  const activeIds = rows.filter((r) => r.status === "active").map((r) => r.id);
  const overdueCutoff = new Date(Date.now() - OVERDUE_MINUTES * 60_000).toISOString();

  const [counts, { data: stepRows }, { data: lastSend }, nextRuns, overdue] = await Promise.all([
    countEnrollmentsBySequence(ctx.svc, ids),
    ids.length
      ? ctx.svc.from("sequence_steps").select("sequence_id, kind").in("sequence_id", ids)
      : Promise.resolve({ data: [] }),
    ctx.svc
      .from("sequence_sends")
      .select("created_at")
      .eq("mailbox_owner_id", ctx.mailboxOwnerId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Earliest queued send per running flow — one small query each, so a flow with thousands of
    // recipients costs the same as one with two.
    Promise.all(
      activeIds.map(async (id) => {
        const { data } = await ctx.svc
          .from("sequence_enrollments")
          .select("next_run_at")
          .eq("sequence_id", id)
          .eq("status", "active")
          .not("next_run_at", "is", null)
          .order("next_run_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        return [id, (data as { next_run_at?: string } | null)?.next_run_at ?? null] as const;
      }),
    ),
    // Due long ago on a flow that is switched on — the scheduler should have taken these already.
    // Counted over the flows this caller can see, so someone else's overdue send is not reported.
    (ctx.isAdmin
      ? ctx.svc
          .from("sequence_enrollments")
          .select("id, sequences!inner(status)", { count: "exact", head: true })
          .eq("mailbox_owner_id", ctx.mailboxOwnerId)
      : ctx.svc
          .from("sequence_enrollments")
          .select("id, sequences!inner(status)", { count: "exact", head: true })
          .eq("mailbox_owner_id", ctx.mailboxOwnerId)
          .in("sequence_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    )
      .eq("status", "active")
      .eq("sequences.status", "active")
      .not("next_run_at", "is", null)
      .lt("next_run_at", overdueCutoff)
      // A running scheduler claims every due row each minute, which refreshes updated_at — even for
      // one it then declines to send (a duplicate it won't resend, say). Only a row nothing has
      // touched for the whole window points at a scheduler that is not running.
      .lt("updated_at", overdueCutoff),
  ]);
  const nextRunBySequence = new Map<string, string | null>(nextRuns);

  const emailStepCounts = new Map<string, number>();
  for (const row of (stepRows ?? []) as { sequence_id: string; kind: string }[]) {
    if (row.kind !== "email") continue;
    emailStepCounts.set(row.sequence_id, (emailStepCounts.get(row.sequence_id) ?? 0) + 1);
  }

  const sequences: SequenceListItem[] = rows.map((row) => {
    const bucket = counts.get(row.id) ?? emptyEnrollmentCounts();
    const recipientCount = Object.entries(bucket)
      .filter(([status]) => status !== "removed")
      .reduce((sum, [, n]) => sum + n, 0);
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      status: row.status,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      origin: row.origin === "scheduled" ? "scheduled" : "sequence",
      scheduledFor: row.scheduled_for ?? null,
      nextRunAt: nextRunBySequence.get(row.id) ?? null,
      emailStepCount: emailStepCounts.get(row.id) ?? 0,
      recipientCount,
      counts: bucket,
    };
  });

  return NextResponse.json({
    sequences,
    // Lets the list page warn when the external pinger has stopped running.
    schedulerLastRunAt: (lastSend as { created_at?: string } | null)?.created_at ?? null,
    // How many due emails the scheduler has not touched for over OVERDUE_MINUTES. Anything above
    // zero means it is not running, which is the one failure the list can't otherwise show.
    overdueCount: overdue.count ?? 0,
  });
}

/** POST /api/sequences — create a draft with one empty email step. */
export async function POST(request: Request) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  let body: { name?: string };
  try {
    body = (await request.json()) as { name?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim().slice(0, 120);
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const { data, error } = await ctx.svc
    .from("sequences")
    .insert({
      mailbox_owner_id: ctx.mailboxOwnerId,
      created_by: ctx.userId,
      name,
    })
    .select("id")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Could not create sequence" }, { status: 500 });
  }

  const { error: stepError } = await ctx.svc.from("sequence_steps").insert({
    sequence_id: data.id,
    mailbox_owner_id: ctx.mailboxOwnerId,
    step_order: 1,
    kind: "email",
    subject_template: "",
    body_html: "",
  });

  if (stepError) {
    await ctx.svc.from("sequences").delete().eq("id", data.id);
    return NextResponse.json({ error: stepError.message }, { status: 500 });
  }

  return NextResponse.json({ id: data.id as string });
}
