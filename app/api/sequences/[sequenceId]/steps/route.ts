import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { listPlaceholdersInTemplate } from "@/lib/mail-merge";
import { planNextEmailStep } from "@/lib/sequence-schedule";
import {
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
  toStepDto,
  toStepLite,
  windowFromSequenceRow,
  type SequenceRecord,
} from "@/lib/sequence-server";
import type { SequenceStep, SequenceStepInput } from "@/lib/sequence-types";

export const runtime = "nodejs";

type Params = { params: { sequenceId: string } };

/**
 * PUT /api/sequences/[id]/steps — whole-list replace. The array order IS the
 * step order, so the editor can add, reorder and delete in one save.
 */
export async function PUT(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  let body: { steps?: SequenceStepInput[] };
  try {
    body = (await request.json()) as { steps?: SequenceStepInput[] };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incoming = body.steps ?? [];
  if (incoming.length === 0) {
    return NextResponse.json({ error: "A sequence needs at least one step" }, { status: 400 });
  }
  if (incoming.some((s) => s.kind !== "email" && s.kind !== "wait")) {
    return NextResponse.json({ error: "Unknown step type" }, { status: 400 });
  }
  if (incoming[0].kind !== "email") {
    return NextResponse.json({ error: "The first step must be an email" }, { status: 400 });
  }

  const { data: existingRows } = await ctx.svc
    .from("sequence_steps")
    .select("id")
    .eq("sequence_id", sequence.id);
  const existingIds = new Set(((existingRows ?? []) as { id: string }[]).map((r) => r.id));

  const now = new Date().toISOString();
  const keptIds: string[] = [];

  for (let index = 0; index < incoming.length; index += 1) {
    const step = incoming[index];
    const isWait = step.kind === "wait";
    const delayDays = Math.max(0, Math.min(365, Math.round(step.delayDays ?? 0)));
    const delayHours = Math.max(0, Math.min(23, Math.round(step.delayHours ?? 0)));

    if (isWait && delayDays + delayHours === 0) {
      return NextResponse.json({ error: "A delay step needs a duration" }, { status: 400 });
    }

    const payload = {
      sequence_id: sequence.id,
      mailbox_owner_id: ctx.mailboxOwnerId,
      step_order: index + 1,
      kind: step.kind,
      subject_template: isWait ? null : (step.subjectTemplate ?? ""),
      body_html: isWait ? null : (step.bodyHtml ?? ""),
      delay_days: isWait ? delayDays : 0,
      delay_hours: isWait ? delayHours : 0,
      updated_at: now,
    };

    if (step.id && existingIds.has(step.id)) {
      const { error } = await ctx.svc.from("sequence_steps").update(payload).eq("id", step.id);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      keptIds.push(step.id);
    } else {
      const { data, error } = await ctx.svc
        .from("sequence_steps")
        .insert(payload)
        .select("id")
        .single();
      if (error || !data) {
        return NextResponse.json({ error: error?.message || "Could not save steps" }, { status: 500 });
      }
      keptIds.push(data.id as string);
    }
  }

  const removed = Array.from(existingIds).filter((id) => !keptIds.includes(id));
  if (removed.length > 0) {
    await ctx.svc.from("sequence_steps").delete().in("id", removed);
  }

  const { data: savedRows } = await ctx.svc
    .from("sequence_steps")
    .select("id, step_order, kind, subject_template, body_html, delay_days, delay_hours")
    .eq("sequence_id", sequence.id)
    .order("step_order");

  const steps = (savedRows ?? []).map(toStepDto);

  // Deleting or reordering a step leaves in-flight recipients pointing at a step
  // that no longer exists (next_step_id is ON DELETE SET NULL). Re-point them at
  // the next surviving email step, or complete them if there isn't one.
  const repaired = await repairOrphanedEnrollments(ctx.svc, sequence, steps);

  const placeholders = Array.from(
    new Set(
      steps
        .filter((s) => s.kind === "email")
        .flatMap((s) => [
          ...listPlaceholdersInTemplate(s.subjectTemplate ?? ""),
          ...listPlaceholdersInTemplate(s.bodyHtml ?? ""),
        ]),
    ),
  );

  return NextResponse.json({ steps, placeholders, repaired });
}

/**
 * Deleting or reordering a step leaves in-flight recipients pointing at a step
 * that no longer exists (next_step_id is ON DELETE SET NULL). Re-point them at
 * the next surviving email step, or complete them if there isn't one.
 */
async function repairOrphanedEnrollments(
  svc: SupabaseClient,
  sequence: SequenceRecord,
  steps: SequenceStep[],
): Promise<number> {
  const { data } = await svc
    .from("sequence_enrollments")
    .select("id, current_step_order")
    .eq("sequence_id", sequence.id)
    .eq("status", "active")
    .is("next_step_id", null);

  const orphans = (data ?? []) as { id: string; current_step_order: number }[];
  if (orphans.length === 0) return 0;

  const window = windowFromSequenceRow(sequence);
  const lite = steps.map(toStepLite);
  const now = new Date();

  for (const orphan of orphans) {
    const plan = planNextEmailStep(lite, orphan.current_step_order, now, window);
    await svc
      .from("sequence_enrollments")
      .update(
        plan
          ? {
              next_step_id: plan.stepId,
              next_run_at: plan.runAt.toISOString(),
              updated_at: now.toISOString(),
            }
          : {
              next_step_id: null,
              next_run_at: null,
              status: "completed",
              completed_at: now.toISOString(),
              updated_at: now.toISOString(),
            },
      )
      .eq("id", orphan.id);
  }
  return orphans.length;
}
