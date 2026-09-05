import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthedRequest } from "@/lib/api-auth";
import { parseTimeToMinutes, type SendWindow } from "@/lib/sequence-schedule";
import { createServiceSupabase } from "@/lib/supabase-service";
import type {
  EnrollmentCounts,
  EnrollmentStatus,
  Sequence,
  SequenceEnrollment,
  SequenceStep,
} from "@/lib/sequence-types";
import { emptyEnrollmentCounts } from "@/lib/sequence-types";

/** Shared plumbing for the /api/sequences routes. */

export type SequenceContext = {
  userId: string;
  /** Tenancy key — admins own their mailbox, staff inherit the linked admin's. */
  mailboxOwnerId: string;
  svc: SupabaseClient;
};

/**
 * Resolve the caller and the mailbox they belong to.
 *
 * Mirrors resolveMailboxGoogleAccessTokenUncached() in lib/mailbox-google-access.ts
 * and the current_mailbox_owner_id() SQL helper used by the RLS policies — all
 * three must agree on the admin/staff branch.
 */
export async function getSequenceContext(
  request: Request,
): Promise<SequenceContext | NextResponse> {
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceSupabase();
  const { data: profile } = await svc
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", authed.user.id)
    .maybeSingle();

  const role = (profile?.role as string) ?? "staff";
  const mailboxOwnerId =
    role === "admin" ? authed.user.id : ((profile?.mailbox_owner_id as string | null) ?? null);

  if (!mailboxOwnerId) {
    return NextResponse.json(
      { error: "Your account is not linked to a mailbox yet. Ask an admin to connect Google." },
      { status: 400 },
    );
  }

  return { userId: authed.user.id, mailboxOwnerId, svc };
}

export function isErrorResponse(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}

export type SequenceRecord = {
  id: string;
  name: string;
  description: string | null;
  status: string;
  published_at: string | null;
  timezone: string;
  send_window_start: string;
  send_window_end: string;
  business_days_only: boolean;
  daily_send_limit: number;
  thread_emails: boolean;
  include_signature: boolean;
  signature_html: string | null;
  track_opens: boolean;
  exit_on_reply: boolean;
  created_at: string;
  updated_at: string;
};

export function toSequenceDto(row: SequenceRecord): Sequence {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    status: row.status as Sequence["status"],
    publishedAt: row.published_at,
    timezone: row.timezone,
    sendWindowStart: row.send_window_start.slice(0, 5),
    sendWindowEnd: row.send_window_end.slice(0, 5),
    businessDaysOnly: row.business_days_only,
    dailySendLimit: row.daily_send_limit,
    threadEmails: row.thread_emails,
    includeSignature: row.include_signature,
    signatureHtml: row.signature_html,
    trackOpens: row.track_opens,
    exitOnReply: row.exit_on_reply,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

type StepRecord = {
  id: string;
  step_order: number;
  kind: string;
  subject_template: string | null;
  body_html: string | null;
  delay_days: number;
  delay_hours: number;
};

export function toStepDto(row: StepRecord): SequenceStep {
  return {
    id: row.id,
    stepOrder: row.step_order,
    kind: row.kind as SequenceStep["kind"],
    subjectTemplate: row.subject_template,
    bodyHtml: row.body_html,
    delayDays: row.delay_days,
    delayHours: row.delay_hours,
  };
}

type EnrollmentRecord = {
  id: string;
  email: string;
  display_name: string | null;
  status: string;
  current_step_order: number;
  next_run_at: string | null;
  first_sent_at: string | null;
  last_sent_at: string | null;
  replied_at: string | null;
  last_error: string | null;
  merge_fields: Record<string, string> | null;
  cc: string | null;
};

export function toEnrollmentDto(row: EnrollmentRecord): SequenceEnrollment {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    status: row.status as EnrollmentStatus,
    currentStepOrder: row.current_step_order,
    nextRunAt: row.next_run_at,
    firstSentAt: row.first_sent_at,
    lastSentAt: row.last_sent_at,
    repliedAt: row.replied_at,
    lastError: row.last_error,
    mergeFields: row.merge_fields ?? {},
    cc: row.cc,
  };
}

/** Per-status recipient tallies for one or more sequences. */
export async function countEnrollmentsBySequence(
  svc: SupabaseClient,
  sequenceIds: string[],
): Promise<Map<string, EnrollmentCounts>> {
  const counts = new Map<string, EnrollmentCounts>();
  if (sequenceIds.length === 0) return counts;

  const { data } = await svc
    .from("sequence_enrollments")
    .select("sequence_id, status")
    .in("sequence_id", sequenceIds);

  for (const id of sequenceIds) counts.set(id, emptyEnrollmentCounts());
  for (const row of (data ?? []) as { sequence_id: string; status: EnrollmentStatus }[]) {
    const bucket = counts.get(row.sequence_id);
    if (bucket && row.status in bucket) bucket[row.status] += 1;
  }
  return counts;
}

/** Loads a sequence, 404-ing when it belongs to another mailbox. */
export async function loadOwnedSequence(
  ctx: SequenceContext,
  sequenceId: string,
): Promise<SequenceRecord | null> {
  const { data } = await ctx.svc
    .from("sequences")
    .select("*")
    .eq("id", sequenceId)
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .maybeSingle();
  return (data as SequenceRecord | null) ?? null;
}

export function notFound() {
  return NextResponse.json({ error: "Sequence not found" }, { status: 404 });
}

export function windowFromSequenceRow(sequence: {
  timezone: string;
  send_window_start: string;
  send_window_end: string;
  business_days_only: boolean;
}): SendWindow {
  return {
    timezone: sequence.timezone,
    startMinutes: parseTimeToMinutes(sequence.send_window_start),
    endMinutes: parseTimeToMinutes(sequence.send_window_end),
    businessDaysOnly: sequence.business_days_only,
  };
}

export function toStepLite(step: SequenceStep) {
  return {
    id: step.id,
    stepOrder: step.stepOrder,
    kind: step.kind,
    delayDays: step.delayDays,
    delayHours: step.delayHours,
  };
}
