import { NextResponse } from "next/server";

import { extractAllEmailsFromText, parseRecipientValue } from "@/lib/email-recipients";
import { normalizeMergeFieldKey } from "@/lib/mail-merge";
import { jitteredStart, planNextEmailStep } from "@/lib/sequence-schedule";
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
import type { EnrollmentStatus } from "@/lib/sequence-types";

export const runtime = "nodejs";

const MAX_PER_REQUEST = 200;

type Params = { params: { sequenceId: string } };

const ENROLLMENT_COLUMNS =
  "id, email, display_name, status, current_step_order, next_run_at, first_sent_at, last_sent_at, replied_at, last_error, merge_fields";

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

  return NextResponse.json({ enrollments: (data ?? []).map(toEnrollmentDto) });
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

  const { data: existingRows } = await ctx.svc
    .from("sequence_enrollments")
    .select("email")
    .eq("sequence_id", sequence.id)
    .in("email", unique);
  const already = new Set(((existingRows ?? []) as { email: string }[]).map((r) => r.email));

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
    .select("id, step_order, kind, subject_template, body_html, delay_days, delay_hours")
    .eq("sequence_id", sequence.id)
    .order("step_order");
  const lite = (stepRows ?? []).map(toStepDto).map(toStepLite);
  const window = windowFromSequenceRow(sequence);
  const now = new Date();

  // Only an enabled sequence gets a schedule; drafts are backfilled on publish.
  const plan = sequence.status === "active" ? planNextEmailStep(lite, 0, now, window) : null;

  const skipped: { email: string; reason: string }[] = [];
  const rows: Record<string, unknown>[] = [];

  for (const email of unique) {
    if (already.has(email)) {
      skipped.push({ email, reason: "duplicate" });
      continue;
    }
    const custom = body.mergeFields?.[email] ?? {};
    const mergeFields: Record<string, string> = {};
    for (const [key, value] of Object.entries(custom)) {
      if (typeof value === "string") mergeFields[normalizeMergeFieldKey(key)] = value;
    }

    rows.push({
      sequence_id: sequence.id,
      mailbox_owner_id: ctx.mailboxOwnerId,
      enrolled_by: ctx.userId,
      email,
      display_name: nameByEmail.get(email) ?? null,
      merge_fields: mergeFields,
      next_step_id: plan?.stepId ?? null,
      next_run_at: plan ? jitteredStart(plan.runAt).toISOString() : null,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json({ added: 0, skipped, warnings });
  }

  const { error } = await ctx.svc.from("sequence_enrollments").insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ added: rows.length, skipped, warnings });
}

export type EnrollmentActionBody = {
  action?: "pause" | "resume" | "restart";
  status?: EnrollmentStatus;
};
