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
};

/** GET /api/sequences — every sequence in the caller's mailbox. */
export async function GET(request: Request) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { data, error } = await ctx.svc
    .from("sequences")
    .select("id, name, description, status, published_at, updated_at")
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .neq("status", "archived")
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as SequenceListRow[];
  const ids = rows.map((r) => r.id);

  const [counts, { data: stepRows }, { data: lastSend }] = await Promise.all([
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
  ]);

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
      emailStepCount: emailStepCounts.get(row.id) ?? 0,
      recipientCount,
      counts: bucket,
    };
  });

  return NextResponse.json({
    sequences,
    // Lets the list page warn when the external pinger has stopped running.
    schedulerLastRunAt: (lastSend as { created_at?: string } | null)?.created_at ?? null,
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
