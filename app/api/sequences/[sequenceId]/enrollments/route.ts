import { NextResponse } from "next/server";

import { extractAllEmailsFromText, parseRecipientValue } from "@/lib/email-recipients";
import { jitteredStart, planNextEmailStep } from "@/lib/sequence-schedule";
import {
  getSequenceContext,
  isErrorResponse,
  loadContactSources,
  loadOwnedSequence,
  notFound,
  resolveEnrollmentMergeFields,
  toEnrollmentDto,
  toStepDto,
  toStepLite,
  windowFromSequenceRow,
} from "@/lib/sequence-server";
import { buildEnrollmentMergeFields } from "@/lib/sequence-variables";
import type { EnrollmentStatus } from "@/lib/sequence-types";

export const runtime = "nodejs";

const MAX_PER_REQUEST = 200;

type Params = { params: { sequenceId: string } };

type EnrollmentRowForFields = Parameters<typeof toEnrollmentDto>[0];

const ENROLLMENT_COLUMNS =
  "id, email, display_name, status, current_step_order, next_run_at, first_sent_at, last_sent_at, replied_at, last_error, merge_fields, cc";

/** GET /api/sequences/[id]/enrollments?status=&q= */
export async function GET(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const url = new URL(request.url);
  const status = url.searchParams.get("status");
  const q = url.searchParams.get("q")?.trim();

  let query = ctx.svc
    .from("sequence_enrollments")
    .select(ENROLLMENT_COLUMNS)
    .eq("sequence_id", sequence.id)
    .neq("status", "removed")
    .order("created_at", { ascending: false })
    .limit(500);

  if (status) query = query.eq("status", status);
  if (q) query = query.ilike("email", `%${q}%`);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Read through to the contacts rather than serving the bag stored at
  // enrollment time: the editor's variable coverage and the preview have to
  // show what would actually be merged if the step went out now.
  const rows = (data ?? []) as EnrollmentRowForFields[];
  const resolved = await resolveEnrollmentMergeFields(ctx.svc, ctx.mailboxOwnerId, rows);

  return NextResponse.json({
    enrollments: rows.map((row) => ({
      ...toEnrollmentDto(row),
      mergeFields: resolved.get(row.email.trim().toLowerCase()) ?? row.merge_fields ?? {},
    })),
  });
}

type PostBody = {
  /** Raw value straight out of <RecipientField>, e.g. "Sai <a@b.com>, c@d.com". */
  recipients?: string;
  mergeFields?: Record<string, Record<string, string>>;
};

export async function POST(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  let body: PostBody;
  try {
    body = (await request.json()) as PostBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.recipients ?? "";
  const { chips, draft } = parseRecipientValue(raw);

  // Chips carry display names; the trailing draft may hold a typed-but-not-yet
  // committed address, so sweep that too rather than silently dropping it.
  const nameByEmail = new Map<string, string>();
  const emails: string[] = [];
  for (const chip of chips) {
    const email = chip.email.trim().toLowerCase();
    if (!email) continue;
    emails.push(email);
    if (chip.displayName?.trim()) nameByEmail.set(email, chip.displayName.trim());
  }
  for (const email of extractAllEmailsFromText(draft)) {
    emails.push(email.trim().toLowerCase());
  }

  const unique = Array.from(new Set(emails)).filter(Boolean);
  if (unique.length === 0) {
    return NextResponse.json({ error: "Add at least one recipient" }, { status: 400 });
  }
  if (unique.length > MAX_PER_REQUEST) {
    return NextResponse.json(
      { error: `Add at most ${MAX_PER_REQUEST} recipients at a time.` },
      { status: 400 },
    );
  }

  // A removed recipient is still a row (DELETE soft-removes by setting
  // status='removed'), and the list deliberately hides those. Counting them as
  // duplicates made re-adding someone impossible: the enroll call reported
  // "already enrolled" about a person no screen could show. Only a row that is
  // still live is a duplicate; a removed one is revived below.
  const { data: existingRows } = await ctx.svc
    .from("sequence_enrollments")
    .select("id, email, status")
    .eq("sequence_id", sequence.id)
    .in("email", unique);

  const already = new Set<string>();
  const revivable = new Map<string, string>();
  for (const row of (existingRows ?? []) as { id: string; email: string; status: string }[]) {
    if (row.status === "removed") revivable.set(row.email, row.id);
    else already.add(row.email);
  }

  // Fields are resolved from contacts at send and preview time, so this stored
  // bag is a starting point rather than the source of truth: it captures the
  // chip's display name for someone with no card, and any custom key an API
  // caller passes. Both contact sources are still read here so a recipient is
  // never enrolled with nothing at all behind their variables.
  const { directoryByEmail, syncedByEmail } = await loadContactSources(
    ctx.svc,
    ctx.mailboxOwnerId,
    unique,
  );

  // Being in two sequences from the same mailbox means two unrelated threads —
  // worth surfacing, but not worth blocking.
  const { data: elsewhere } = await ctx.svc
    .from("sequence_enrollments")
    .select("email, sequences!inner(name)")
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .neq("sequence_id", sequence.id)
    .eq("status", "active")
    .in("email", unique);

  const warnings = ((elsewhere ?? []) as unknown as {
    email: string;
    sequences: { name: string } | { name: string }[];
  }[]).map((row) => ({
    email: row.email,
    otherSequenceName: Array.isArray(row.sequences) ? row.sequences[0]?.name : row.sequences?.name,
  }));

  const { data: stepRows } = await ctx.svc
    .from("sequence_steps")
    .select("id, step_order, kind, subject_template, body_html, delay_days, delay_hours, delay_minutes")
    .eq("sequence_id", sequence.id)
    .order("step_order");
  const lite = (stepRows ?? []).map(toStepDto).map(toStepLite);
  const window = windowFromSequenceRow(sequence);
  const now = new Date();

  // Only an enabled sequence gets a schedule; drafts are backfilled on publish.
  const plan = sequence.status === "active" ? planNextEmailStep(lite, 0, now, window) : null;

  const skipped: { email: string; reason: string }[] = [];
  const rows: Record<string, unknown>[] = [];
  const revive: { id: string; fields: Record<string, unknown> }[] = [];

  for (const email of unique) {
    if (already.has(email)) {
      skipped.push({ email, reason: "duplicate" });
      continue;
    }
    const mergeFields = buildEnrollmentMergeFields(email, {
      directory: directoryByEmail.get(email),
      synced: syncedByEmail.get(email),
      displayName: nameByEmail.get(email),
      // Explicit mergeFields from the request (unused by today's UI, but kept
      // for API callers) win over the contact-derived defaults.
      custom: body.mergeFields?.[email],
    });

    const revivableId = revivable.get(email);
    if (revivableId) {
      // Same reset the "restart" action performs: adding someone back is a
      // fresh conversation, so the old thread pointers and terminal timestamps
      // must not survive — otherwise the first email would thread onto the
      // attempt they were removed from.
      revive.push({
        id: revivableId,
        fields: {
          status: "active",
          display_name: nameByEmail.get(email) ?? null,
          merge_fields: mergeFields,
          current_step_order: 0,
          next_step_id: plan?.stepId ?? null,
          next_run_at: plan ? jitteredStart(plan.runAt).toISOString() : null,
          gmail_thread_id: null,
          last_gmail_message_id: null,
          first_sent_at: null,
          replied_at: null,
          completed_at: null,
          last_error: null,
          attempt_count: 0,
          claimed_at: null,
          claim_token: null,
          updated_at: now.toISOString(),
        },
      });
      continue;
    }

    rows.push({
      sequence_id: sequence.id,
      mailbox_owner_id: ctx.mailboxOwnerId,
      enrolled_by: ctx.userId,
      email,
      display_name: nameByEmail.get(email) ?? null,
      merge_fields: mergeFields,
      // Cc is per-recipient only — set afterward from that row's own "⋮"
      // menu, never applied in bulk when adding a batch of recipients.
      cc: null,
      next_step_id: plan?.stepId ?? null,
      next_run_at: plan ? jitteredStart(plan.runAt).toISOString() : null,
    });
  }

  for (const row of revive) {
    const { error } = await ctx.svc
      .from("sequence_enrollments")
      .update(row.fields)
      .eq("id", row.id)
      .eq("sequence_id", sequence.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (rows.length > 0) {
    const { error } = await ctx.svc.from("sequence_enrollments").insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    added: rows.length,
    revived: revive.length,
    skipped,
    warnings,
  });
}

export type EnrollmentActionBody = {
  action?: "pause" | "resume" | "restart";
  status?: EnrollmentStatus;
};
