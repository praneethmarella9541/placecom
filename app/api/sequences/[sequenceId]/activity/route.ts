import { NextResponse } from "next/server";

import {
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
} from "@/lib/sequence-server";
import type { SequenceSend } from "@/lib/sequence-types";

export const runtime = "nodejs";

type Params = { params: { sequenceId: string } };

type SendRow = {
  id: string;
  step_id: string | null;
  status: string;
  to_email: string;
  subject: string | null;
  gmail_thread_id: string | null;
  error: string | null;
  created_at: string;
};

/** GET /api/sequences/[id]/activity?enrollmentId= — the send log. */
export async function GET(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const url = new URL(request.url);
  const enrollmentId = url.searchParams.get("enrollmentId");
  const limit = Math.min(200, Number(url.searchParams.get("limit") ?? 100) || 100);

  let query = ctx.svc
    .from("sequence_sends")
    .select("id, step_id, status, to_email, subject, gmail_thread_id, error, created_at")
    .eq("sequence_id", sequence.id)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (enrollmentId) query = query.eq("enrollment_id", enrollmentId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const sends: SequenceSend[] = ((data ?? []) as SendRow[]).map((row) => ({
    id: row.id,
    stepId: row.step_id,
    status: row.status as SequenceSend["status"],
    toEmail: row.to_email,
    subject: row.subject,
    gmailThreadId: row.gmail_thread_id,
    error: row.error,
    createdAt: row.created_at,
  }));

  return NextResponse.json({ sends });
}
