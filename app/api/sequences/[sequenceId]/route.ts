import { NextResponse } from "next/server";

import { isValidTimeZone, parseTimeToMinutes } from "@/lib/sequence-schedule";
import {
  countEnrollmentsBySequence,
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
  toSequenceDto,
  toStepDto,
} from "@/lib/sequence-server";
import { emptyEnrollmentCounts } from "@/lib/sequence-types";

export const runtime = "nodejs";

type Params = { params: { sequenceId: string } };

export async function GET(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const [{ data: steps }, counts] = await Promise.all([
    ctx.svc
      .from("sequence_steps")
      .select("id, step_order, kind, subject_template, body_html, delay_days, delay_hours")
      .eq("sequence_id", sequence.id)
      .order("step_order"),
    countEnrollmentsBySequence(ctx.svc, [sequence.id]),
  ]);

  return NextResponse.json({
    sequence: toSequenceDto(sequence),
    steps: (steps ?? []).map(toStepDto),
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
};

export async function PATCH(request: Request, { params }: Params) {
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

  const { data, error } = await ctx.svc
    .from("sequences")
    .update(patch)
    .eq("id", sequence.id)
    .select("*")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: error?.message || "Could not save" }, { status: 500 });
  }

  return NextResponse.json({ sequence: toSequenceDto(data) });
}

/** Archives the sequence; only an unsent draft is deleted outright. */
export async function DELETE(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const { count } = await ctx.svc
    .from("sequence_sends")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", sequence.id);

  if (sequence.status === "draft" && (count ?? 0) === 0) {
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
