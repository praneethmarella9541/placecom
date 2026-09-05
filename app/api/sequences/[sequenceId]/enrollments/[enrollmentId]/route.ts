import { NextResponse } from "next/server";

import { extractAllEmailsFromText } from "@/lib/email-recipients";
import { normalizeMergeFieldKey } from "@/lib/mail-merge";
import { planNextEmailStep } from "@/lib/sequence-schedule";
import {
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
  toEnrollmentDto,
  toStepDto,
  toStepLite,
  windowFromSequenceRow,
} from "@/lib/sequence-server";

export const runtime = "nodejs";

type Params = { params: { sequenceId: string; enrollmentId: string } };

type PatchBody = {
  action?: "pause" | "resume" | "restart";
  displayName?: string | null;
  mergeFields?: Record<string, string>;
  cc?: string | null;
};

const ENROLLMENT_COLUMNS =
  "id, email, display_name, status, current_step_order, next_run_at, first_sent_at, last_sent_at, replied_at, last_error, merge_fields, cc";

export async function PATCH(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const { data: existing } = await ctx.svc
    .from("sequence_enrollments")
    .select("id, current_step_order, status")
    .eq("id", params.enrollmentId)
    .eq("sequence_id", sequence.id)
    .maybeSingle();

  if (!existing) return NextResponse.json({ error: "Recipient not found" }, { status: 404 });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const now = new Date();
  const patch: Record<string, unknown> = { updated_at: now.toISOString() };

  if (body.displayName !== undefined) {
    patch.display_name = body.displayName?.trim() || null;
  }
  if (body.mergeFields !== undefined) {
    const fields: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.mergeFields)) {
      if (typeof value === "string") fields[normalizeMergeFieldKey(key)] = value;
    }
    patch.merge_fields = fields;
  }
  if (body.cc !== undefined) {
    patch.cc = body.cc === null ? null : extractAllEmailsFromText(body.cc).join(", ") || null;
  }

  if (body.action === "pause") {
    patch.status = "paused";
    patch.next_run_at = null;
    patch.claimed_at = null;
  }

  if (body.action === "resume" || body.action === "restart") {
    const restart = body.action === "restart";
    const { data: stepRows } = await ctx.svc
      .from("sequence_steps")
      .select("id, step_order, kind, subject_template, body_html, delay_days, delay_hours")
      .eq("sequence_id", sequence.id)
      .order("step_order");

    const lite = (stepRows ?? []).map(toStepDto).map(toStepLite);
    const fromOrder = restart ? 0 : (existing.current_step_order as number);
    const plan = planNextEmailStep(lite, fromOrder, now, windowFromSequenceRow(sequence));

    if (restart) {
      // A restart is a fresh conversation, so drop the old thread pointers —
      // otherwise the first email would thread onto the previous attempt.
      patch.current_step_order = 0;
      patch.gmail_thread_id = null;
      patch.last_gmail_message_id = null;
      patch.first_sent_at = null;
      patch.replied_at = null;
      patch.completed_at = null;
    }

    patch.status = plan ? "active" : "completed";
    patch.next_step_id = plan?.stepId ?? null;
    patch.next_run_at = plan && sequence.status === "active" ? plan.runAt.toISOString() : null;
    patch.attempt_count = 0;
    patch.last_error = null;
    patch.claimed_at = null;
    if (!plan) patch.completed_at = now.toISOString();
  }

  const { data, error } = await ctx.svc
    .from("sequence_enrollments")
    .update(patch)
    .eq("id", params.enrollmentId)
    .select(ENROLLMENT_COLUMNS)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Could not update" }, { status: 500 });
  }

  return NextResponse.json({ enrollment: toEnrollmentDto(data) });
}

/** Soft-removes by default; ?hard=1 also drops the send log. */
export async function DELETE(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const hard = new URL(request.url).searchParams.get("hard") === "1";

  if (hard) {
    await ctx.svc
      .from("sequence_enrollments")
      .delete()
      .eq("id", params.enrollmentId)
      .eq("sequence_id", sequence.id);
    return NextResponse.json({ deleted: true });
  }

  await ctx.svc
    .from("sequence_enrollments")
    .update({
      status: "removed",
      next_run_at: null,
      next_step_id: null,
      claimed_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.enrollmentId)
    .eq("sequence_id", sequence.id);

  return NextResponse.json({ removed: true });
}
