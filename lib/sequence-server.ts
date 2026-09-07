import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthedRequest } from "@/lib/api-auth";
import { parseTimeToMinutes, type SendWindow } from "@/lib/sequence-schedule";
import {
  buildEnrollmentMergeFields,
  type DirectoryCardFields,
  type SyncedContactFields,
} from "@/lib/sequence-variables";
import { createServiceSupabase } from "@/lib/supabase-service";
import type {
  EnrollmentCounts,
  EnrollmentStatus,
  Sequence,
  SequenceEnrollment,
  SequenceStep,
  SequenceStepAttachment,
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
  variable_fallbacks: Record<string, string> | null;
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
    variableFallbacks: row.variable_fallbacks ?? {},
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
  delay_minutes: number;
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
    delayMinutes: row.delay_minutes ?? 0,
  };
}

/**
 * Attach each step's files to the DTOs a route is about to return.
 *
 * Kept out of toStepDto because the attachments are a second query — steps are
 * mapped in several places, and only the ones the editor reads need them.
 */
export async function withStepAttachments(
  ctx: SequenceContext,
  steps: SequenceStep[],
): Promise<SequenceStep[]> {
  const stepIds = steps.map((s) => s.id);
  if (stepIds.length === 0) return steps;

  const { data } = await ctx.svc
    .from("sequence_step_attachments")
    .select("id, step_id, filename, mime_type, size_bytes, created_at")
    .in("step_id", stepIds)
    .order("created_at");

  const byStep = new Map<string, SequenceStepAttachment[]>();
  for (const row of (data ?? []) as AttachmentRecord[]) {
    const list = byStep.get(row.step_id) ?? [];
    list.push({
      id: row.id,
      stepId: row.step_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      createdAt: row.created_at,
    });
    byStep.set(row.step_id, list);
  }

  return steps.map((s) => ({ ...s, attachments: byStep.get(s.id) ?? [] }));
}

type AttachmentRecord = {
  id: string;
  step_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

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

/**
 * Case-insensitive `email in (…)` as a PostgREST filter.
 *
 * A directory card stores the address exactly as it was typed (the create
 * route only trims it), so matching lowercased recipient addresses with `.in()`
 * would miss a card saved as "Sai@Example.com". Addresses carrying a character
 * that would break out of the or() syntax are dropped rather than escaped —
 * none of them are valid in an unquoted address. `_` stays a LIKE wildcard, so
 * the query can over-match; callers key results by lowercased email and look up
 * exact addresses, which discards anything extra.
 */
function emailInFilter(emails: string[]): string | null {
  const safe = emails.filter((e) => e && !/[,()"*\s\\]/.test(e));
  return safe.length ? safe.map((e) => `email.ilike.${e}`).join(",") : null;
}

/** Chunked so a large enrollment batch can't build an over-long query string. */
const EMAIL_FILTER_CHUNK = 50;

/**
 * The two contact sources a recipient's merge fields are built from, keyed by
 * lowercased email.
 *
 * Same pair mass-send compose reads (directory card, then mailbox sync) and
 * scoped to the caller's mailbox on both, so a sequence can never merge in a
 * contact belonging to another admin's team.
 */
export async function loadContactSources(
  svc: SupabaseClient,
  mailboxOwnerId: string,
  emails: string[],
): Promise<{
  directoryByEmail: Map<string, DirectoryCardFields>;
  syncedByEmail: Map<string, SyncedContactFields>;
}> {
  const directoryByEmail = new Map<string, DirectoryCardFields>();
  const syncedByEmail = new Map<string, SyncedContactFields>();
  const wanted = new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (wanted.size === 0) return { directoryByEmail, syncedByEmail };

  const chunks: string[][] = [];
  const list = Array.from(wanted);
  for (let i = 0; i < list.length; i += EMAIL_FILTER_CHUNK) {
    chunks.push(list.slice(i, i + EMAIL_FILTER_CHUNK));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const filter = emailInFilter(chunk);
      if (!filter) return;

      const [{ data: cards }, { data: synced }] = await Promise.all([
        svc
          .from("directory_contacts")
          .select("email, name, company, title, phone")
          .eq("mailbox_owner_id", mailboxOwnerId)
          .or(filter),
        svc
          .from("synced_contacts")
          .select("email, display_name, company_name, last_interaction_at")
          .eq("mailbox_owner_id", mailboxOwnerId)
          .or(filter),
      ]);

      for (const row of (cards ?? []) as (DirectoryCardFields & { email: string | null })[]) {
        const key = row.email?.trim().toLowerCase();
        // First card wins: duplicates under one address have no tiebreaker
        // better than order, and choosing arbitrarily each load would be worse.
        if (key && wanted.has(key) && !directoryByEmail.has(key)) directoryByEmail.set(key, row);
      }
      for (const row of (synced ?? []) as SyncedContactFields[]) {
        const key = row.email?.trim().toLowerCase();
        if (key && wanted.has(key) && !syncedByEmail.has(key)) syncedByEmail.set(key, row);
      }
    }),
  );

  return { directoryByEmail, syncedByEmail };
}

/**
 * A recipient's merge fields, read through to the contacts they come from.
 *
 * This is mass sending's model: compose never stores a recipient's fields, it
 * resolves them from the Team Directory card and the mailbox sync every time it
 * renders or sends. Sequences do the same here, so a card filled in or
 * corrected after enrollment is simply true the next time a step goes out —
 * there is nothing to keep in sync by hand.
 *
 * The enrollment's own stored bag is still consulted, but only as the weakest
 * layer: it carries the chip's display name for people with no card at all, and
 * any custom key set through the enrollments API, neither of which a contact
 * source can produce.
 */
export async function resolveEnrollmentMergeFields(
  svc: SupabaseClient,
  mailboxOwnerId: string,
  rows: Array<{ email: string; display_name: string | null; merge_fields: Record<string, string> | null }>,
): Promise<Map<string, Record<string, string>>> {
  const out = new Map<string, Record<string, string>>();
  if (rows.length === 0) return out;

  const emails = rows.map((r) => r.email.trim().toLowerCase());
  const { directoryByEmail, syncedByEmail } = await loadContactSources(svc, mailboxOwnerId, emails);

  for (const row of rows) {
    const email = row.email.trim().toLowerCase();
    out.set(
      email,
      buildEnrollmentMergeFields(email, {
        directory: directoryByEmail.get(email),
        synced: syncedByEmail.get(email),
        displayName: row.display_name,
        existing: row.merge_fields,
      }),
    );
  }

  return out;
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
    delayMinutes: step.delayMinutes ?? 0,
  };
}
