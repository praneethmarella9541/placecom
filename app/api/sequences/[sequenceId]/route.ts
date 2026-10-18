import { NextResponse } from "next/server";

import { normalizeMergeFieldKey } from "@/lib/mail-merge";
import { purgeAttachmentsForSteps } from "@/lib/sequence-attachments";
import type { SupabaseClient } from "@supabase/supabase-js";

import { isValidTimeZone, nextSendSlot, parseTimeToMinutes, planNextEmailStep } from "@/lib/sequence-schedule";
import {
  countEnrollmentsBySequence,
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
  toSequenceDto,
  toStepDto,
  toStepLite,
  windowFromSequenceRow,
  withStepAttachments,
} from "@/lib/sequence-server";
import { emptyEnrollmentCounts } from "@/lib/sequence-types";

export const runtime = "nodejs";

type Params = { params: Promise<{ sequenceId: string }> };

export async function GET(request: Request, props: Params) {
  const params = await props.params;
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const [{ data: steps }, counts] = await Promise.all([
    ctx.svc
      .from("sequence_steps")
      .select("id, step_order, kind, subject_template, body_html, delay_days, delay_hours, delay_minutes, send_at")
      .eq("sequence_id", sequence.id)
      .order("step_order"),
    countEnrollmentsBySequence(ctx.svc, [sequence.id]),
  ]);

  return NextResponse.json({
    sequence: toSequenceDto(sequence),
    steps: await withStepAttachments(ctx, (steps ?? []).map(toStepDto)),
    counts: counts.get(sequence.id) ?? emptyEnrollmentCounts(),
  });
}

type PatchBody = {
  name?: string;
  description?: string | null;
  timezone?: string;
  sendWindowStart?: string;
  sendWindowEnd?: string;
  businessDaysOnly?: boolean;
  dailySendLimit?: number;
  threadEmails?: boolean;
  includeSignature?: boolean;
  signatureHtml?: string | null;
  trackOpens?: boolean;
  exitOnReply?: boolean;
  /** Whole map, not a delta — the preview screen sends the set it wants kept. */
  variableFallbacks?: Record<string, string>;
};

/** Cap per value: a fallback stands in for a name or a job title, not prose. */
const MAX_FALLBACK_LENGTH = 200;
const MAX_FALLBACKS = 50;

export async function PATCH(request: Request, props: Params) {
  const params = await props.params;
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.name !== undefined) {
    const name = body.name.trim().slice(0, 120);
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    patch.name = name;
  }
  if (body.description !== undefined) {
    patch.description = body.description?.trim().slice(0, 500) || null;
  }
  if (body.timezone !== undefined) {
    // Intl throws on a bad zone, which inside the cron would kill the whole run.
    if (!isValidTimeZone(body.timezone)) {
      return NextResponse.json({ error: "Unknown timezone" }, { status: 400 });
    }
    patch.timezone = body.timezone;
  }
  if (body.sendWindowStart !== undefined) patch.send_window_start = body.sendWindowStart;
  if (body.sendWindowEnd !== undefined) patch.send_window_end = body.sendWindowEnd;

  const nextStart = (patch.send_window_start as string) ?? sequence.send_window_start;
  const nextEnd = (patch.send_window_end as string) ?? sequence.send_window_end;
  if (parseTimeToMinutes(nextStart) >= parseTimeToMinutes(nextEnd)) {
    return NextResponse.json(
      { error: "The sending window must start before it ends." },
      { status: 400 },
    );
  }

  if (body.businessDaysOnly !== undefined) patch.business_days_only = body.businessDaysOnly;
  if (body.dailySendLimit !== undefined) {
    const limit = Math.round(body.dailySendLimit);
    if (!Number.isFinite(limit) || limit < 1 || limit > 2000) {
      return NextResponse.json({ error: "Daily limit must be between 1 and 2000" }, { status: 400 });
    }
    patch.daily_send_limit = limit;
  }
  if (body.threadEmails !== undefined) patch.thread_emails = body.threadEmails;
  if (body.includeSignature !== undefined) patch.include_signature = body.includeSignature;
  if (body.signatureHtml !== undefined) patch.signature_html = body.signatureHtml || null;
  if (body.trackOpens !== undefined) patch.track_opens = body.trackOpens;
  if (body.exitOnReply !== undefined) patch.exit_on_reply = body.exitOnReply;
  if (body.variableFallbacks !== undefined) {
    const fallbacks: Record<string, string> = {};
    for (const [key, value] of Object.entries(body.variableFallbacks)) {
      if (typeof value !== "string" || !value.trim()) continue;
      const k = normalizeMergeFieldKey(key);
      // A key mergeTemplate could never match would be a value nothing reads.
      if (!k || Object.keys(fallbacks).length >= MAX_FALLBACKS) continue;
      fallbacks[k] = value.trim().slice(0, MAX_FALLBACK_LENGTH);
    }
    patch.variable_fallbacks = fallbacks;
  }

  const { data, error } = await ctx.svc
    .from("sequences")
    .update(patch)
    .eq("id", sequence.id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Could not save" }, { status: 500 });
  }

  // Send times are stored per recipient when they are enrolled, so a changed window or weekday
  // rule does nothing to a recipient already waiting for their turn until it is re-planned here.
  const windowChanged = ["send_window_start", "send_window_end", "business_days_only", "timezone"].some(
    (k) => k in patch && patch[k] !== (sequence as unknown as Record<string, unknown>)[k],
  );
  if (windowChanged) {
    try {
      await replanWaitingEnrollments(ctx.svc, data);
    } catch (e) {
      console.error("[sequences] could not re-plan waiting recipients", e);
    }
  }

  return NextResponse.json({ sequence: toSequenceDto(data) });
}

/**
 * Re-plans active recipients against the sequence's current window. Someone whose first email has
 * not gone out is planned afresh from now (or the scheduled start, if later); someone part-way
 * through keeps their wait and is only moved to the next slot that fits the new window.
 */
async function replanWaitingEnrollments(
  svc: SupabaseClient,
  sequence: Parameters<typeof windowFromSequenceRow>[0] & { id: string; scheduled_for?: string | null },
) {
  const window = windowFromSequenceRow(sequence);
  const [{ data: stepRows }, { data: enrollments }] = await Promise.all([
    svc.from("sequence_steps").select("*").eq("sequence_id", sequence.id),
    svc
      .from("sequence_enrollments")
      .select("id, current_step_order, next_run_at")
      .eq("sequence_id", sequence.id)
      .eq("status", "active")
      .not("next_run_at", "is", null),
  ]);
  if (!enrollments?.length) return;

  const lite = (stepRows ?? []).map((r) => toStepLite(toStepDto(r)));
  const now = new Date();
  const scheduledFor = sequence.scheduled_for ? new Date(sequence.scheduled_for) : null;
  const firstFrom = scheduledFor && scheduledFor > now ? scheduledFor : now;

  for (const e of enrollments as { id: string; current_step_order: number; next_run_at: string }[]) {
    let runAt: Date | null;
    if (e.current_step_order === 0) {
      runAt = planNextEmailStep(lite, 0, firstFrom, window)?.runAt ?? null;
    } else {
      const due = new Date(e.next_run_at);
      runAt = nextSendSlot(due > now ? due : now, window);
    }
    if (!runAt || runAt.getTime() === new Date(e.next_run_at).getTime()) continue;
    await svc
      .from("sequence_enrollments")
      .update({ next_run_at: runAt.toISOString(), updated_at: now.toISOString() })
      .eq("id", e.id);
  }
}

/** Archives the sequence; only an unsent draft is deleted outright. */
export async function DELETE(request: Request, props: Params) {
  const params = await props.params;
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const { count } = await ctx.svc
    .from("sequence_sends")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", sequence.id);

  if (sequence.status === "draft" && (count ?? 0) === 0) {
    const { data: stepRows } = await ctx.svc
      .from("sequence_steps")
      .select("id")
      .eq("sequence_id", sequence.id);
    // Erasing the sequence outright must not leave its attachments in storage.
    await purgeAttachmentsForSteps(
      ctx.svc,
      ((stepRows ?? []) as { id: string }[]).map((r) => r.id),
    );
    await ctx.svc.from("sequences").delete().eq("id", sequence.id);
    return NextResponse.json({ deleted: true });
  }

  await ctx.svc
    .from("sequences")
    .update({ status: "archived", updated_at: new Date().toISOString() })
    .eq("id", sequence.id);
  // Stop the scheduler touching this sequence's recipients again.
  await ctx.svc
    .from("sequence_enrollments")
    .update({ next_run_at: null, updated_at: new Date().toISOString() })
    .eq("sequence_id", sequence.id)
    .eq("status", "active");

  return NextResponse.json({ archived: true });
}
