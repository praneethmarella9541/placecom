import { NextResponse } from "next/server";

import { jitteredStart, planNextEmailStep } from "@/lib/sequence-schedule";
import {
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
  toSequenceDto,
  toStepDto,
  toStepLite,
  windowFromSequenceRow,
} from "@/lib/sequence-server";

export const runtime = "nodejs";

type Params = { params: { sequenceId: string } };
type Body = { action?: "publish" | "pause" | "resume" };

/** POST /api/sequences/[id]/publish — enable, pause or resume sending. */
export async function POST(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action ?? "publish";
  const now = new Date();

  if (action === "pause") {
    const { data } = await ctx.svc
      .from("sequences")
      .update({ status: "paused", updated_at: now.toISOString() })
      .eq("id", sequence.id)
      .select("*")
      .single();
    return NextResponse.json({ sequence: data ? toSequenceDto(data) : null, scheduled: 0 });
  }

  const { data: stepRows } = await ctx.svc
    .from("sequence_steps")
    .select("id, step_order, kind, subject_template, body_html, delay_days, delay_hours")
    .eq("sequence_id", sequence.id)
    .order("step_order");

  const steps = (stepRows ?? []).map(toStepDto);
  const emailSteps = steps.filter((s) => s.kind === "email");

  if (emailSteps.length === 0) {
    return NextResponse.json({ error: "Add at least one email step first." }, { status: 400 });
  }

  // When threading is on, every email after the first is sent as a reply and
  // deliberately has no subject of its own (SequenceStepList locks that field
  // blank) — only the first email step needs one. The step's position in
  // sequence_steps counts delay steps too, so it's re-numbered here against
  // just the email steps to match what the editor actually shows the user
  // ("Email 2"), not the raw step_order the DB gap would otherwise report.
  for (let i = 0; i < emailSteps.length; i++) {
    const s = emailSteps[i];
    const needsSubject = !sequence.thread_emails || i === 0;
    const missingSubject = needsSubject && !s.subjectTemplate?.trim();
    const missingBody = !s.bodyHtml?.trim();
    if (!missingSubject && !missingBody) continue;

    const what = missingSubject && missingBody ? "a subject and a body" : missingSubject ? "a subject" : "a body";
    return NextResponse.json(
      { error: `Email ${i + 1} needs ${what}.` },
      { status: 400 },
    );
  }

  const { data: updated } = await ctx.svc
    .from("sequences")
    .update({
      status: "active",
      published_at: sequence.published_at ?? now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq("id", sequence.id)
    .select("*")
    .single();

  // Give every waiting recipient a slot. Recipients mid-sequence keep the
  // next_run_at they already have; only unscheduled ones are backfilled.
  const { data: pending } = await ctx.svc
    .from("sequence_enrollments")
    .select("id, current_step_order")
    .eq("sequence_id", sequence.id)
    .eq("status", "active")
    .is("next_run_at", null);

  const window = windowFromSequenceRow(sequence);
  const lite = steps.map(toStepLite);
  let scheduled = 0;

  for (const row of (pending ?? []) as { id: string; current_step_order: number }[]) {
    const plan = planNextEmailStep(lite, row.current_step_order, now, window);
    if (!plan) {
      await ctx.svc
        .from("sequence_enrollments")
        .update({ status: "completed", completed_at: now.toISOString(), updated_at: now.toISOString() })
        .eq("id", row.id);
      continue;
    }
    await ctx.svc
      .from("sequence_enrollments")
      .update({
        next_step_id: plan.stepId,
        // Spread the batch so they don't all hit Gmail at the same second.
        next_run_at: jitteredStart(plan.runAt).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq("id", row.id);
    scheduled += 1;
  }

  return NextResponse.json({
    sequence: updated ? toSequenceDto(updated) : null,
    scheduled,
  });
}
