import { NextResponse } from "next/server";

import { isValidEmail } from "@/lib/broadcast-recipients";
import { stripVariableSpans } from "@/lib/compose-variables";
import { getStagedAttachment, releaseStagedAttachments } from "@/lib/draft-attachment-staging";
import { GMAIL_ATTACHMENT_MAX_BYTES } from "@/lib/gmail-draft-limits";
import {
  purgeAttachmentsForSteps,
  removeStepAttachmentFile,
  uploadStepAttachment,
} from "@/lib/sequence-attachments";
import {
  isValidTimeZone,
  parseTimeToMinutes,
  planNextEmailStep,
  type SequenceStepLite,
} from "@/lib/sequence-schedule";
import {
  getSequenceContext,
  isErrorResponse,
  loadContactSources,
  windowFromSequenceRow,
} from "@/lib/sequence-server";
import { buildEnrollmentMergeFields } from "@/lib/sequence-variables";

export const runtime = "nodejs";
export const maxDuration = 120;

/** Same ceiling the immediate mass send has in practice; far above any real campaign. */
const MAX_RECIPIENTS = 5000;
const MAX_FOLLOW_UPS = 10;
const MAX_DELAY_DAYS = 90;
const INSERT_CHUNK = 500;

type FollowUpInput = {
  delayDays?: number;
  delayHours?: number;
  delayMinutes?: number;
  /** Ignored when threading is on (the follow-up replies in the first email's thread). */
  subject?: string;
  bodyHtml?: string;
};

type RecipientInput = {
  email?: string;
  displayName?: string | null;
  /** Spreadsheet columns or other per-recipient merge values. */
  fields?: Record<string, string>;
};

type ScheduleBody = {
  name?: string;
  subject?: string;
  bodyHtml?: string;
  followUps?: FollowUpInput[];
  /** ISO start time; omitted or null = as soon as the send window allows. */
  startAt?: string | null;
  recipients?: RecipientInput[];
  cc?: string;
  bcc?: string;
  settings?: {
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
  variableFallbacks?: Record<string, string>;
  mergeSource?: "contacts" | "stored";
  labelIds?: string[];
  /** Small files the browser already holds as base64. */
  attachments?: { filename?: string; mimeType?: string; base64Data?: string }[];
  /** Larger files uploaded in chunks to the draft staging area. */
  stagedUploadIds?: string[];
  /** Files over Gmail's limit, kept on Drive and sent as a link. */
  driveFiles?: {
    id?: string;
    name?: string;
    mimeType?: string;
    size?: number;
    webViewLink?: string;
  }[];
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bad(error: string, status = 400) {
  return NextResponse.json({ error }, { status });
}

/**
 * POST /api/sequences/schedule — turn the composer's "Scheduling" toggle into a running flow.
 *
 * Creates a sequence (origin "scheduled") with the first email, then a wait + email for each
 * follow-up, copies the attachments into durable storage, enrols every recipient and activates it.
 * From there the existing cron does the sending, so it carries on when the user is away. All or
 * nothing: any failure removes what was created.
 */
export async function POST(request: Request) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  let body: ScheduleBody;
  try {
    body = (await request.json()) as ScheduleBody;
  } catch {
    return bad("Invalid JSON");
  }

  // ── Validate the content ────────────────────────────────────────────────
  const subject = (body.subject ?? "").trim();
  const bodyHtml = body.bodyHtml ?? "";
  if (!subject) return bad("Add a subject before scheduling.");
  if (!bodyHtml.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim() && !/<img\b/i.test(bodyHtml)) {
    return bad("Write a message before scheduling.");
  }

  const settingsIn = body.settings ?? {};
  const timezone = settingsIn.timezone?.trim() || "Asia/Kolkata";
  if (!isValidTimeZone(timezone)) return bad("That time zone isn't recognised.");

  const sendWindowStart = settingsIn.sendWindowStart?.trim() || "09:00";
  const sendWindowEnd = settingsIn.sendWindowEnd?.trim() || "17:00";
  const timeShape = /^([01]?\d|2[0-3]):[0-5]\d$/;
  if (!timeShape.test(sendWindowStart) || !timeShape.test(sendWindowEnd)) {
    return bad("The send window times aren't valid.");
  }
  const startMinutes = parseTimeToMinutes(sendWindowStart);
  const endMinutes = parseTimeToMinutes(sendWindowEnd);
  if (!(startMinutes < endMinutes)) return bad("The send window must end after it starts.");

  const threadEmails = settingsIn.threadEmails !== false;
  const followUps = (body.followUps ?? []).slice(0, MAX_FOLLOW_UPS + 1);
  if (followUps.length > MAX_FOLLOW_UPS) return bad(`Add at most ${MAX_FOLLOW_UPS} follow-ups.`);
  for (let i = 0; i < followUps.length; i++) {
    const f = followUps[i];
    const days = clampInt(f.delayDays, 0, MAX_DELAY_DAYS, 0);
    const hours = clampInt(f.delayHours, 0, 23, 0);
    const minutes = clampInt(f.delayMinutes, 0, 59, 0);
    if (days === 0 && hours === 0 && minutes === 0) return bad(`Set a wait before follow-up ${i + 1}.`);
    if (!(f.bodyHtml ?? "").replace(/<[^>]*>/g, "").trim()) return bad(`Follow-up ${i + 1} needs a message.`);
    if (!threadEmails && !(f.subject ?? "").trim()) return bad(`Follow-up ${i + 1} needs a subject.`);
  }

  // ── Recipients ──────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const recipients: { email: string; displayName: string | null; fields: Record<string, string> }[] = [];
  for (const r of body.recipients ?? []) {
    const email = (r.email ?? "").trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    if (!isValidEmail(email)) return bad(`"${email}" isn't a valid email address.`);
    seen.add(email);
    const fields: Record<string, string> = {};
    for (const [k, v] of Object.entries(r.fields ?? {})) {
      if (typeof v === "string" && v.trim()) fields[k] = v.trim();
    }
    recipients.push({ email, displayName: r.displayName?.trim() || null, fields });
  }
  if (recipients.length === 0) return bad("Add at least one recipient.");
  if (recipients.length > MAX_RECIPIENTS) {
    return bad(`Schedule at most ${MAX_RECIPIENTS.toLocaleString()} recipients at a time.`);
  }

  // ── Start time ──────────────────────────────────────────────────────────
  const now = new Date();
  let startAt: Date | null = null;
  if (body.startAt) {
    startAt = new Date(body.startAt);
    if (Number.isNaN(startAt.getTime())) return bad("The start time isn't valid.");
    if (startAt.getTime() < now.getTime() - 60_000) return bad("The start time is in the past.");
  }
  const from = startAt && startAt.getTime() > now.getTime() ? startAt : now;

  const mergeSource = body.mergeSource === "stored" ? "stored" : "contacts";
  const name = (body.name?.trim() || subject).slice(0, 120);
  const cc = (body.cc ?? "").trim() || null;
  const bcc = (body.bcc ?? "").trim() || null;
  const useCopies = recipients.length === 1;

  // ── Create the sequence ────────────────────────────────────────────────
  const { data: created, error: createError } = await ctx.svc
    .from("sequences")
    .insert({
      mailbox_owner_id: ctx.mailboxOwnerId,
      created_by: ctx.userId,
      name,
      origin: "scheduled",
      status: "active",
      published_at: now.toISOString(),
      scheduled_for: startAt ? startAt.toISOString() : null,
      timezone,
      send_window_start: sendWindowStart,
      send_window_end: sendWindowEnd,
      business_days_only: settingsIn.businessDaysOnly !== false,
      daily_send_limit: clampInt(settingsIn.dailySendLimit, 1, 2000, 200),
      thread_emails: threadEmails,
      include_signature: settingsIn.includeSignature === true,
      signature_html: settingsIn.signatureHtml?.trim() || null,
      track_opens: settingsIn.trackOpens !== false,
      exit_on_reply: settingsIn.exitOnReply !== false,
      variable_fallbacks: body.variableFallbacks ?? {},
      merge_source: mergeSource,
      label_ids: (body.labelIds ?? []).filter((id) => typeof id === "string" && id && !id.startsWith("pending:")),
    })
    .select("*")
    .single();

  if (createError || !created) {
    return bad(createError?.message || "Could not schedule this send.", 500);
  }
  const sequenceId = created.id as string;

  const rollback = async () => {
    const { data: stepIds } = await ctx.svc.from("sequence_steps").select("id").eq("sequence_id", sequenceId);
    await purgeAttachmentsForSteps(
      ctx.svc,
      ((stepIds ?? []) as { id: string }[]).map((s) => s.id),
    ).catch(() => {});
    await ctx.svc.from("sequences").delete().eq("id", sequenceId);
  };

  try {
    // ── Steps: email 1, then wait + email per follow-up ───────────────────
    const stepRows: Record<string, unknown>[] = [
      {
        sequence_id: sequenceId,
        mailbox_owner_id: ctx.mailboxOwnerId,
        step_order: 1,
        kind: "email",
        subject_template: subject,
        body_html: stripVariableSpans(bodyHtml),
        // One insert carries email and wait rows together, so every row needs every column:
        // a missing key is sent as null, which the not-null delay columns refuse.
        delay_days: 0,
        delay_hours: 0,
        delay_minutes: 0,
      },
    ];
    let order = 2;
    for (const f of followUps) {
      stepRows.push({
        sequence_id: sequenceId,
        mailbox_owner_id: ctx.mailboxOwnerId,
        step_order: order++,
        kind: "wait",
        subject_template: null,
        body_html: null,
        delay_days: clampInt(f.delayDays, 0, MAX_DELAY_DAYS, 0),
        delay_hours: clampInt(f.delayHours, 0, 23, 0),
        delay_minutes: clampInt(f.delayMinutes, 0, 59, 0),
      });
      stepRows.push({
        sequence_id: sequenceId,
        mailbox_owner_id: ctx.mailboxOwnerId,
        step_order: order++,
        kind: "email",
        subject_template: threadEmails ? "" : (f.subject ?? "").trim(),
        body_html: stripVariableSpans(f.bodyHtml ?? ""),
        delay_days: 0,
        delay_hours: 0,
        delay_minutes: 0,
      });
    }

    const { data: insertedSteps, error: stepsError } = await ctx.svc
      .from("sequence_steps")
      .insert(stepRows)
      .select("id, step_order, kind, delay_days, delay_hours, delay_minutes");
    if (stepsError || !insertedSteps) throw new Error(stepsError?.message || "Could not save the steps.");

    const steps = insertedSteps as {
      id: string;
      step_order: number;
      kind: "email" | "wait";
      delay_days: number;
      delay_hours: number;
      delay_minutes: number;
    }[];
    const firstStep = steps.find((s) => s.step_order === 1);
    if (!firstStep) throw new Error("Could not save the first email.");

    // ── Attachments (first email) ─────────────────────────────────────────
    const attachmentBase = {
      sequence_id: sequenceId,
      step_id: firstStep.id,
      mailbox_owner_id: ctx.mailboxOwnerId,
      created_by: ctx.userId,
    };
    const files: { filename: string; mimeType: string; buffer: Buffer }[] = [];
    for (const a of body.attachments ?? []) {
      if (!a.base64Data || !a.filename) continue;
      files.push({
        filename: a.filename,
        mimeType: a.mimeType || "application/octet-stream",
        buffer: Buffer.from(a.base64Data, "base64"),
      });
    }
    const stagedIds = (body.stagedUploadIds ?? []).filter((id): id is string => typeof id === "string" && !!id);
    for (const uploadId of stagedIds) {
      const staged = await getStagedAttachment(ctx.userId, uploadId);
      if (!staged) {
        throw Object.assign(
          new Error("An attachment didn't finish uploading. Wait for the upload to complete, then schedule again."),
          { status: 409 },
        );
      }
      files.push({
        filename: staged.filename,
        mimeType: staged.mimeType || "application/octet-stream",
        buffer: Buffer.from(staged.base64Data, "base64"),
      });
    }
    for (const file of files) {
      if (file.buffer.length > GMAIL_ATTACHMENT_MAX_BYTES) {
        throw Object.assign(
          new Error(`"${file.filename}" is over Gmail's 25 MB limit. Share it as a Google Drive link instead.`),
          { status: 400 },
        );
      }
      const storagePath = await uploadStepAttachment({
        mailboxOwnerId: ctx.mailboxOwnerId,
        sequenceId,
        stepId: firstStep.id,
        file: file.buffer,
        filename: file.filename,
        mimeType: file.mimeType,
      });
      const { error } = await ctx.svc.from("sequence_step_attachments").insert({
        ...attachmentBase,
        storage_path: storagePath,
        filename: file.filename,
        mime_type: file.mimeType,
        size_bytes: file.buffer.length,
      });
      if (error) {
        await removeStepAttachmentFile(storagePath);
        throw new Error(error.message);
      }
    }
    for (const d of body.driveFiles ?? []) {
      if (!d.id || !d.webViewLink || !d.name) continue;
      const { error } = await ctx.svc.from("sequence_step_attachments").insert({
        ...attachmentBase,
        drive_file_id: d.id,
        web_view_link: d.webViewLink,
        filename: d.name,
        mime_type: d.mimeType || "application/octet-stream",
        size_bytes: d.size ?? 0,
      });
      if (error) throw new Error(error.message);
    }

    // ── Plan and enrol ────────────────────────────────────────────────────
    const lite: SequenceStepLite[] = steps.map((s) => ({
      id: s.id,
      stepOrder: s.step_order,
      kind: s.kind,
      delayDays: s.delay_days,
      delayHours: s.delay_hours,
      delayMinutes: s.delay_minutes ?? 0,
    }));
    const window = windowFromSequenceRow(created);
    const plan = planNextEmailStep(lite, 0, from, window);
    if (!plan) throw new Error("Could not plan the first send.");

    const { directoryByEmail, syncedByEmail } =
      mergeSource === "contacts"
        ? await loadContactSources(
            ctx.svc,
            ctx.mailboxOwnerId,
            recipients.map((r) => r.email),
          )
        : { directoryByEmail: new Map(), syncedByEmail: new Map() };

    // Everyone is due at the planned time, exactly. A batch is not spread with a random delay:
    // the runner already sends about four mails a second at most (and 60 per tick), so a large
    // audience paces itself, and a user who picks 9:00 gets 9:00.
    const enrollmentRows = recipients.map((r) => ({
      sequence_id: sequenceId,
      mailbox_owner_id: ctx.mailboxOwnerId,
      enrolled_by: ctx.userId,
      email: r.email,
      display_name: r.displayName,
      merge_fields: buildEnrollmentMergeFields(r.email, {
        directory: directoryByEmail.get(r.email),
        synced: syncedByEmail.get(r.email),
        displayName: r.displayName,
        custom: r.fields,
      }),
      cc: useCopies ? cc : null,
      bcc: useCopies ? bcc : null,
      next_step_id: plan.stepId,
      next_run_at: plan.runAt.toISOString(),
    }));

    for (let i = 0; i < enrollmentRows.length; i += INSERT_CHUNK) {
      const { error } = await ctx.svc.from("sequence_enrollments").insert(enrollmentRows.slice(i, i + INSERT_CHUNK));
      if (error) throw new Error(error.message);
    }

    if (stagedIds.length > 0) void releaseStagedAttachments(ctx.userId, stagedIds).catch(() => {});

    return NextResponse.json({
      sequenceId,
      scheduled: enrollmentRows.length,
      firstRunAt: plan.runAt.toISOString(),
    });
  } catch (e) {
    await rollback();
    const err = e as Error & { status?: number };
    return bad(err.message || "Could not schedule this send.", err.status ?? 500);
  }
}
