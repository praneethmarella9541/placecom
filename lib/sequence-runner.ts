import "server-only";

import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { extractEmailAddress } from "@/lib/email-parse";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";
import { getThreadMessages, sendMailViaGmail, type SendAttachment } from "@/lib/gmail-inbox";
import { getMailboxAccessTokenForOwner } from "@/lib/mailbox-google-token";
import { loadStepSendAttachments } from "@/lib/sequence-attachments";
import { buildStepEmail } from "@/lib/sequence-body";
import {
  isWithinSendWindow,
  nextSendSlot,
  planNextEmailStep,
  zonedParts,
  zonedTimeToUtc,
} from "@/lib/sequence-schedule";
import { resolveEnrollmentMergeFields, windowFromSequenceRow } from "@/lib/sequence-server";
import { createServiceSupabase } from "@/lib/supabase-service";

/**
 * The sequences scheduler. Driven by an external pinger hitting
 * GET /api/cron/sequences; see lib/sequence-schedule.ts for the timing rules.
 *
 * Safety model — both layers are required:
 *  - claimDueSequenceEnrollments() leases rows via a conditional UPDATE (see
 *    its own comment for why — not the `claim_due_sequence_enrollments()`
 *    Postgres function of the same name that still exists in migration 0036),
 *    so two overlapping runs never pick the same enrollment;
 *  - a partial unique index on sequence_sends (enrollment_id, step_id) where
 *    status in ('sending','sent') makes a duplicate send impossible even if a
 *    lease is somehow bypassed (double invocation, retry after a network blip).
 */

/**
 * Work budget for one tick. Sized for cron-job.org, which closes the connection
 * after 30s — the tick has to answer well inside that or every run is logged as
 * a timeout. The check runs between enrollments, so one in-flight send can
 * overshoot; 20s leaves room for that plus the pre-flight claim/token queries.
 * Callers with a longer-lived pinger can raise it up to MAX_DEADLINE_MS.
 */
const DEFAULT_DEADLINE_MS = 20_000;
/** Ceiling on an override — still under the route's maxDuration of 300s. */
const MAX_DEADLINE_MS = 240_000;
const MIN_DEADLINE_MS = 5_000;
const BATCH_SIZE = 25;
const MAX_SENDS_PER_RUN = 60;
/** Same pacing as app/api/broadcast/email/route.ts. */
const GAP_MS = 250;
const LEASE_SECONDS = 300;
const TOKEN_BACKOFF_MS = 15 * 60_000;
/** A send stuck mid-flight past this is assumed dead and released for retry. */
const STUCK_SEND_MINUTES = 15;
const MAX_ATTEMPTS = 3;
/** Ceiling on base64 held across one run's attachment cache. */
const MAX_ATTACHMENT_CACHE_BYTES = 40 * 1024 * 1024;

export type CronSummary = {
  ok: true;
  dryRun: boolean;
  claimed: number;
  sent: number;
  skipped: number;
  replied: number;
  bounced: number;
  failed: number;
  mailboxes: number;
  durationMs: number;
};

type EnrollmentRow = {
  id: string;
  sequence_id: string;
  mailbox_owner_id: string;
  email: string;
  display_name: string | null;
  merge_fields: Record<string, string> | null;
  cc: string | null;
  current_step_order: number;
  next_step_id: string | null;
  attempt_count: number;
  gmail_thread_id: string | null;
  last_gmail_message_id: string | null;
  first_sent_at: string | null;
};

type SequenceRow = {
  id: string;
  mailbox_owner_id: string;
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
};

type StepRow = {
  id: string;
  sequence_id: string;
  step_order: number;
  kind: "email" | "wait";
  subject_template: string | null;
  body_html: string | null;
  delay_days: number;
  delay_hours: number;
  delay_minutes: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Start of the current local day, as a UTC instant — for the daily send cap. */
function startOfLocalDay(now: Date, timezone: string): Date {
  const parts = zonedParts(now, timezone);
  return zonedTimeToUtc({ ...parts, hour: 0, minute: 0 }, timezone);
}

/** Auto-responders must not be mistaken for a real reply. */
function looksAutomated(subject: string): boolean {
  return /^\s*(automatic reply|auto[- ]?reply|out of office|ooo\b)/i.test(subject);
}

function isBounceSender(email: string): boolean {
  return /(^|\W)(mailer-daemon|postmaster)@/i.test(email);
}

type RunContext = {
  svc: SupabaseClient;
  dryRun: boolean;
  summary: CronSummary;
  /**
   * Step id → its files, base64'd, downloaded at most once per run. Every
   * recipient of a step gets the same attachments, so fetching them per
   * enrollment would re-download the same bytes for the whole batch.
   */
  attachmentCache: Map<string, SendAttachment[]>;
  attachmentCacheBytes: number;
};

/** Hand a lease back so the row is retried on a later tick. */
async function releaseClaim(
  ctx: RunContext,
  enrollmentId: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await ctx.svc
    .from("sequence_enrollments")
    .update({ claimed_at: null, claim_token: null, updated_at: new Date().toISOString(), ...patch })
    .eq("id", enrollmentId);
}

async function finishEnrollment(
  ctx: RunContext,
  enrollmentId: string,
  status: string,
  patch: Record<string, unknown> = {},
): Promise<void> {
  await releaseClaim(ctx, enrollmentId, { status, next_run_at: null, ...patch });
}

/**
 * Look for a reply or a bounce in the thread we started.
 *
 * Uses the stored thread id rather than a Gmail search: it is the exact
 * conversation, so there is no risk of matching unrelated mail from the same
 * person and no dependency on Gmail's search indexing lag.
 */
async function checkThreadForExit(
  accessToken: string,
  threadId: string,
  enrollment: EnrollmentRow,
  mailboxAddress: string | undefined,
  mailboxKey: string,
): Promise<"replied" | "bounced" | null> {
  let messages;
  try {
    ({ messages } = await getThreadMessages(accessToken, threadId, { mailboxKey }));
  } catch {
    // Thread deleted or momentarily unavailable — never block the send on this.
    return null;
  }

  const ourAddress = mailboxAddress?.trim().toLowerCase();
  const firstSentAt = enrollment.first_sent_at ? Date.parse(enrollment.first_sent_at) : 0;

  for (const message of messages) {
    const from = extractEmailAddress(message.from).toLowerCase();
    if (!from) continue;
    if (ourAddress && from === ourAddress) continue;
    if (isBounceSender(from)) return "bounced";

    const receivedAt = Date.parse(message.date);
    if (Number.isFinite(receivedAt) && firstSentAt && receivedAt < firstSentAt) continue;
    if (looksAutomated(message.subject ?? "")) continue;

    // We started this thread, so any other inbound participant is the recipient
    // replying — including from an alias or an assistant's address.
    return "replied";
  }

  return null;
}

type MailboxContext = {
  accessToken: string;
  /** Mailbox owner id — bills this run's Gmail calls to the right quota bucket. */
  ownerId: string;
  mailboxAddress?: string;
  sentTodayBySequence: Map<string, number>;
};

async function processEnrollment(
  ctx: RunContext,
  enrollment: EnrollmentRow,
  sequence: SequenceRow,
  steps: StepRow[],
  mailbox: MailboxContext,
  /** Contact-resolved fields for this recipient, from the caller's batch lookup. */
  resolved: { mergeFields: Record<string, string> },
): Promise<void> {
  const window = windowFromSequenceRow(sequence);
  const now = new Date();

  const step = steps.find((s) => s.id === enrollment.next_step_id && s.kind === "email");
  if (!step) {
    // The step was deleted or reordered out from under this recipient.
    const plan = planNextEmailStep(
      steps.map((s) => ({
        id: s.id,
        stepOrder: s.step_order,
        kind: s.kind,
        delayDays: s.delay_days,
        delayHours: s.delay_hours,
        delayMinutes: s.delay_minutes ?? 0,
      })),
      enrollment.current_step_order,
      now,
      window,
    );
    if (plan) {
      await releaseClaim(ctx, enrollment.id, {
        next_step_id: plan.stepId,
        next_run_at: plan.runAt.toISOString(),
      });
    } else {
      await finishEnrollment(ctx, enrollment.id, "completed", { completed_at: now.toISOString() });
    }
    return;
  }

  // 1. Exit criteria — reply or bounce in the thread we started.
  if (sequence.exit_on_reply && enrollment.gmail_thread_id) {
    const outcome = await checkThreadForExit(
      mailbox.accessToken,
      enrollment.gmail_thread_id,
      enrollment,
      mailbox.mailboxAddress,
      mailbox.ownerId,
    );
    if (outcome === "replied") {
      ctx.summary.replied += 1;
      await finishEnrollment(ctx, enrollment.id, "replied", {
        replied_at: now.toISOString(),
        reply_checked_at: now.toISOString(),
      });
      return;
    }
    if (outcome === "bounced") {
      ctx.summary.bounced += 1;
      await finishEnrollment(ctx, enrollment.id, "bounced", {
        reply_checked_at: now.toISOString(),
        last_error: "Delivery failed — the address bounced.",
      });
      return;
    }
  }

  // 2. The window is authoritative at send time, not at schedule time — settings
  //    may have changed since next_run_at was written.
  if (!isWithinSendWindow(now, window)) {
    await releaseClaim(ctx, enrollment.id, {
      next_run_at: nextSendSlot(now, window).toISOString(),
      reply_checked_at: now.toISOString(),
    });
    return;
  }

  // 3. Daily cap for this sequence, in the sequence's own timezone.
  const sentToday = mailbox.sentTodayBySequence.get(sequence.id) ?? 0;
  if (sentToday >= sequence.daily_send_limit) {
    const tomorrow = nextSendSlot(new Date(now.getTime() + 24 * 3_600_000), window);
    await releaseClaim(ctx, enrollment.id, { next_run_at: tomorrow.toISOString() });
    return;
  }

  // 4. Merge and validate. mergeTemplate leaves unknown placeholders literal, so
  //    a missing field would put a raw {{first_name}} in front of a recipient.
  const built = buildStepEmail(
    {
      subjectTemplate: step.subject_template ?? "",
      bodyHtml: step.body_html ?? "",
      includeSignature: sequence.include_signature,
      signatureHtml: sequence.signature_html,
      variableFallbacks: sequence.variable_fallbacks,
    },
    {
      email: enrollment.email,
      displayName: enrollment.display_name,
      mergeFields: resolved.mergeFields,
    },
  );

  if (built.missing.length > 0) {
    ctx.summary.skipped += 1;
    if (!ctx.dryRun) {
      await ctx.svc.from("sequence_sends").insert({
        enrollment_id: enrollment.id,
        sequence_id: sequence.id,
        step_id: step.id,
        mailbox_owner_id: sequence.mailbox_owner_id,
        to_email: enrollment.email,
        subject: built.subject || null,
        status: "skipped",
        error: `Missing merge fields: ${built.missing.join(", ")}`,
      });
      await finishEnrollment(ctx, enrollment.id, "needs_attention", {
        last_error: `Missing merge fields: ${built.missing.join(", ")}`,
      });
    }
    return;
  }

  if (ctx.dryRun) {
    ctx.summary.sent += 1;
    await releaseClaim(ctx, enrollment.id);
    return;
  }

  // 5. Claim the send slot. A unique violation means another worker owns it.
  const { data: sendRow, error: sendClaimError } = await ctx.svc
    .from("sequence_sends")
    .insert({
      enrollment_id: enrollment.id,
      sequence_id: sequence.id,
      step_id: step.id,
      mailbox_owner_id: sequence.mailbox_owner_id,
      to_email: enrollment.email,
      subject: built.subject || null,
      attempt: enrollment.attempt_count + 1,
      status: "sending",
    })
    .select("id")
    .single();

  if (sendClaimError || !sendRow) {
    await releaseClaim(ctx, enrollment.id);
    return;
  }

  // 6. Tracking pixel — same pattern as app/api/gmail/send/route.ts. The cron has
  //    no session, so opens are recorded against the mailbox owner and read back
  //    via sequence_sends.tracking_id rather than by user_id.
  let trackingId: string | null = null;
  let trackingPixelUrl: string | undefined;
  if (sequence.track_opens) {
    try {
      const { data: trackRow } = await ctx.svc
        .from("email_tracking")
        .insert({
          user_id: sequence.mailbox_owner_id,
          gmail_message_id: "__pending__",
          to_address: enrollment.email,
          subject: built.subject || null,
        })
        .select("id")
        .single();
      if (trackRow) {
        trackingId = trackRow.id as string;
        trackingPixelUrl = `${getAppUrl()}/api/track/${trackingId}`;
      }
    } catch {
      /* tracking is best-effort */
    }
  }

  // 7. Send. Follow-ups pass an empty subject so sendMailViaGmail derives
  //    "Re: <original>" from the previous message — Gmail only threads when the
  //    subject matches, so letting the helper derive it is what makes it work.
  const threading = sequence.thread_emails && Boolean(enrollment.gmail_thread_id);

  let attachments = ctx.attachmentCache.get(step.id);
  if (!attachments) {
    attachments = await loadStepSendAttachments(step.id);
    // Bounded: caching is a bandwidth optimisation, and a run touching several
    // heavily-attached steps must not trade a re-download for an out-of-memory
    // kill that loses the whole batch.
    const bytes = attachments.reduce((sum, a) => sum + a.base64Data.length, 0);
    if (ctx.attachmentCacheBytes + bytes <= MAX_ATTACHMENT_CACHE_BYTES) {
      ctx.attachmentCache.set(step.id, attachments);
      ctx.attachmentCacheBytes += bytes;
    }
  }

  try {
    const result = await sendMailViaGmail(mailbox.accessToken, {
      to: enrollment.email,
      cc: enrollment.cc || undefined,
      subject: threading ? "" : built.subject,
      textBody: built.text,
      htmlBody: built.html,
      threadId: threading ? enrollment.gmail_thread_id ?? undefined : undefined,
      inReplyToMessageId: threading ? enrollment.last_gmail_message_id ?? undefined : undefined,
      trackingPixelUrl,
      attachments: attachments.length > 0 ? attachments : undefined,
      mailboxKey: mailbox.ownerId,
    });

    const sentAt = new Date().toISOString();
    ctx.summary.sent += 1;
    mailbox.sentTodayBySequence.set(sequence.id, sentToday + 1);

    await ctx.svc
      .from("sequence_sends")
      .update({
        status: "sent",
        gmail_message_id: result.id,
        gmail_thread_id: result.threadId,
        tracking_id: trackingId,
        updated_at: sentAt,
      })
      .eq("id", sendRow.id);

    if (trackingId) {
      await ctx.svc
        .from("email_tracking")
        .update({ gmail_message_id: result.id })
        .eq("id", trackingId);
    }

    const plan = planNextEmailStep(
      steps.map((s) => ({
        id: s.id,
        stepOrder: s.step_order,
        kind: s.kind,
        delayDays: s.delay_days,
        delayHours: s.delay_hours,
        delayMinutes: s.delay_minutes ?? 0,
      })),
      step.step_order,
      new Date(),
      window,
    );

    await ctx.svc
      .from("sequence_enrollments")
      .update({
        current_step_order: step.step_order,
        // Always store the thread id, even when threading is off, so reply
        // detection still has a conversation to inspect.
        gmail_thread_id: result.threadId,
        last_gmail_message_id: result.id,
        first_sent_at: enrollment.first_sent_at ?? sentAt,
        last_sent_at: sentAt,
        attempt_count: 0,
        last_error: null,
        claimed_at: null,
        claim_token: null,
        next_step_id: plan?.stepId ?? null,
        next_run_at: plan ? plan.runAt.toISOString() : null,
        status: plan ? "active" : "completed",
        completed_at: plan ? null : sentAt,
        updated_at: sentAt,
      })
      .eq("id", enrollment.id);
  } catch (err) {
    const error = err as Error & { code?: string };
    const message = error.message || "Send failed";
    ctx.summary.failed += 1;

    await ctx.svc
      .from("sequence_sends")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", sendRow.id);

    if (trackingId) {
      await ctx.svc.from("email_tracking").delete().eq("id", trackingId);
    }

    // A token problem is not this recipient's fault — don't burn an attempt.
    if (error.code === "UNAUTHORIZED" || error.code === GMAIL_INSUFFICIENT_SCOPE) {
      await releaseClaim(ctx, enrollment.id, {
        next_run_at: new Date(Date.now() + TOKEN_BACKOFF_MS).toISOString(),
        last_error: message,
      });
      throw error; // abort the rest of this mailbox — every send will fail alike
    }

    const attempts = enrollment.attempt_count + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await finishEnrollment(ctx, enrollment.id, "failed", {
        attempt_count: attempts,
        last_error: message,
      });
      return;
    }

    const backoffMs = 10 * 60_000 * 2 ** (attempts - 1);
    await releaseClaim(ctx, enrollment.id, {
      attempt_count: attempts,
      last_error: message,
      next_run_at: new Date(Date.now() + backoffMs).toISOString(),
    });
  }
}

/**
 * Leases up to `limit` due enrollments.
 *
 * This used to be one round trip to a `claim_due_sequence_enrollments()`
 * Postgres function (`SELECT ... FOR UPDATE SKIP LOCKED`, still present in
 * migration 0036 but no longer called from here). On this project that RPC
 * reproducibly returned zero rows through this exact service-role connection
 * while an identical plain SELECT through the same connection — and the same
 * SQL run directly against the database — found the rows immediately every
 * time. The function's owner has BYPASSRLS, so it isn't a RLS-inside-
 * SECURITY-DEFINER issue either; the divergence sits specifically in calling
 * a function via PostgREST's RPC path versus a plain table request, which
 * is a platform-level anomaly, not an application bug — see the commit that
 * added this replacement for the full diagnostic trail.
 *
 * This does the same job as two plain requests instead: a SELECT for
 * candidates, ordered and limited exactly like the RPC was, followed by a
 * conditional UPDATE per row. The UPDATE's WHERE clause re-checks the same
 * claimability conditions at write time rather than trusting the read — that
 * substitutes for `FOR UPDATE SKIP LOCKED`: two concurrent callers targeting
 * the same row serialize on Postgres's own row lock, and whichever loses
 * finds `claimed_at` no longer null when its blocked UPDATE finally runs, so
 * it affects zero rows and is correctly treated as "someone else has it."
 * The only difference from SKIP LOCKED is a brief block instead of an
 * instant skip, which is immaterial at this workload's scale (single-digit
 * enrollments per minute).
 */
async function claimDueSequenceEnrollments(
  svc: SupabaseClient,
  limit: number,
  leaseSeconds: number,
): Promise<EnrollmentRow[]> {
  const nowIso = new Date().toISOString();
  const staleCutoffIso = new Date(Date.now() - leaseSeconds * 1000).toISOString();
  // Re-used on both the select and every per-row update below — must be
  // identical each time, or a row claimable at select time could look
  // already-fresh (and get skipped) by the time its update runs.
  const claimableFilter = `claimed_at.is.null,claimed_at.lt.${staleCutoffIso}`;

  const { data: candidates, error: selectError } = await svc
    .from("sequence_enrollments")
    .select("id, sequences!inner(status)")
    .eq("status", "active")
    .eq("sequences.status", "active")
    .not("next_run_at", "is", null)
    .lte("next_run_at", nowIso)
    .or(claimableFilter)
    .order("next_run_at", { ascending: true })
    .limit(limit);

  if (selectError) throw new Error(`Claim select failed: ${selectError.message}`);

  const claimed: EnrollmentRow[] = [];
  for (const candidate of (candidates ?? []) as { id: string }[]) {
    const { data: updated, error: updateError } = await svc
      .from("sequence_enrollments")
      .update({ claimed_at: nowIso, claim_token: randomUUID(), updated_at: nowIso })
      .eq("id", candidate.id)
      .eq("status", "active")
      .or(claimableFilter)
      .select("*")
      .maybeSingle();

    if (updateError) throw new Error(`Claim update failed: ${updateError.message}`);
    if (updated) claimed.push(updated as EnrollmentRow);
  }

  return claimed;
}

export async function runSequencesCron(
  options: { dryRun?: boolean; deadlineMs?: number } = {},
): Promise<CronSummary> {
  const startedAt = Date.now();
  const deadlineMs = Math.min(
    MAX_DEADLINE_MS,
    Math.max(MIN_DEADLINE_MS, Math.trunc(options.deadlineMs ?? DEFAULT_DEADLINE_MS)),
  );
  const svc = createServiceSupabase();
  const summary: CronSummary = {
    ok: true,
    dryRun: Boolean(options.dryRun),
    claimed: 0,
    sent: 0,
    skipped: 0,
    replied: 0,
    bounced: 0,
    failed: 0,
    mailboxes: 0,
    durationMs: 0,
  };

  const ctx: RunContext = {
    svc,
    dryRun: Boolean(options.dryRun),
    summary,
    attachmentCache: new Map(),
    attachmentCacheBytes: 0,
  };

  // Release sends abandoned by a crashed worker so they can be retried.
  await svc
    .from("sequence_sends")
    .update({ status: "failed", error: "Worker timed out", updated_at: new Date().toISOString() })
    .eq("status", "sending")
    .lt("created_at", new Date(Date.now() - STUCK_SEND_MINUTES * 60_000).toISOString());

  const seenMailboxes = new Set<string>();
  // Some outcomes (dry run, a send slot another worker owns, a mailbox abort)
  // release the lease without pushing next_run_at forward, so the row is still
  // due. Without this guard the next claim would hand back the same rows and the
  // loop would spin until the deadline making no progress.
  const handled = new Set<string>();

  while (Date.now() - startedAt < deadlineMs && summary.sent < MAX_SENDS_PER_RUN) {
    const claimedRows = await claimDueSequenceEnrollments(svc, BATCH_SIZE, LEASE_SECONDS);
    if (claimedRows.length === 0) break;

    const rows = claimedRows.filter((row) => !handled.has(row.id));
    if (rows.length === 0) {
      // Everything due has already been seen this run — stop and let the next tick take it.
      for (const row of claimedRows) await releaseClaim(ctx, row.id);
      break;
    }
    for (const row of rows) handled.add(row.id);
    summary.claimed += rows.length;

    const byMailbox = new Map<string, EnrollmentRow[]>();
    for (const row of rows) {
      const list = byMailbox.get(row.mailbox_owner_id) ?? [];
      list.push(row);
      byMailbox.set(row.mailbox_owner_id, list);
    }

    const sequenceIds = Array.from(new Set(rows.map((r) => r.sequence_id)));
    const [{ data: sequenceRows }, { data: stepRows }] = await Promise.all([
      svc.from("sequences").select("*").in("id", sequenceIds),
      svc.from("sequence_steps").select("*").in("sequence_id", sequenceIds).order("step_order"),
    ]);

    const sequences = new Map<string, SequenceRow>(
      ((sequenceRows ?? []) as SequenceRow[]).map((s) => [s.id, s]),
    );
    const stepsBySequence = new Map<string, StepRow[]>();
    for (const step of (stepRows ?? []) as StepRow[]) {
      const list = stepsBySequence.get(step.sequence_id) ?? [];
      list.push(step);
      stepsBySequence.set(step.sequence_id, list);
    }

    for (const [ownerId, enrollments] of Array.from(byMailbox.entries())) {
      seenMailboxes.add(ownerId);

      // One token resolve per mailbox, not per enrollment.
      const token = await getMailboxAccessTokenForOwner(ownerId);
      if (!token.ok) {
        for (const enrollment of enrollments) {
          await releaseClaim(ctx, enrollment.id, {
            next_run_at: new Date(Date.now() + TOKEN_BACKOFF_MS).toISOString(),
            last_error: token.message,
          });
        }
        continue;
      }

      const mailbox: MailboxContext = {
        accessToken: token.accessToken,
        ownerId,
        mailboxAddress: token.gmailAddress,
        sentTodayBySequence: new Map(),
      };

      // Merge fields are read from the contacts now, not from the copy taken
      // when these people were enrolled — the same thing mass sending does,
      // where a recipient's variables are resolved from their card at send
      // time. One lookup for the whole mailbox's batch, not one per email.
      const resolvedFields = await resolveEnrollmentMergeFields(
        svc,
        ownerId,
        enrollments.map((e: EnrollmentRow) => ({
          email: e.email,
          display_name: e.display_name,
          merge_fields: e.merge_fields,
        })),
      );

      // Seed today's counts so the daily cap survives across cron ticks.
      const mailboxSequenceIds = Array.from(
        new Set(enrollments.map((e: EnrollmentRow) => e.sequence_id)),
      );
      for (const sequenceId of mailboxSequenceIds) {
        const sequence = sequences.get(sequenceId);
        if (!sequence) continue;
        const { count } = await svc
          .from("sequence_sends")
          .select("id", { count: "exact", head: true })
          .eq("sequence_id", sequenceId)
          .eq("status", "sent")
          .gte("created_at", startOfLocalDay(new Date(), sequence.timezone).toISOString());
        mailbox.sentTodayBySequence.set(sequenceId, count ?? 0);
      }

      try {
        for (const enrollment of enrollments) {
          if (Date.now() - startedAt > deadlineMs || summary.sent >= MAX_SENDS_PER_RUN) {
            await releaseClaim(ctx, enrollment.id);
            continue;
          }
          const sequence = sequences.get(enrollment.sequence_id);
          const steps = stepsBySequence.get(enrollment.sequence_id);
          if (!sequence || !steps) {
            await releaseClaim(ctx, enrollment.id);
            continue;
          }
          await processEnrollment(ctx, enrollment, sequence, steps, mailbox, {
            mergeFields:
              resolvedFields.get(enrollment.email.trim().toLowerCase()) ??
              enrollment.merge_fields ??
              {},
          });
          await sleep(GAP_MS);
        }
      } catch {
        // Mailbox-level abort (token died mid-run): hand back every remaining lease.
        for (const enrollment of enrollments) {
          await releaseClaim(ctx, enrollment.id);
        }
      }
    }
  }

  summary.mailboxes = seenMailboxes.size;
  summary.durationMs = Date.now() - startedAt;
  return summary;
}
