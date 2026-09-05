import { NextResponse } from "next/server";

import { buildStepEmail } from "@/lib/sequence-body";
import {
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
} from "@/lib/sequence-server";

export const runtime = "nodejs";

type Params = { params: { sequenceId: string } };
type Body = { stepId?: string; enrollmentId?: string };

/**
 * POST /api/sequences/[id]/preview — render a step exactly as the cron would.
 *
 * Deliberately goes through the same buildStepEmail() the scheduler uses; a
 * preview that renders differently from the real send is worse than none.
 */
export async function POST(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.stepId) return NextResponse.json({ error: "stepId is required" }, { status: 400 });

  const { data: step } = await ctx.svc
    .from("sequence_steps")
    .select("id, kind, subject_template, body_html")
    .eq("id", body.stepId)
    .eq("sequence_id", sequence.id)
    .maybeSingle();

  if (!step) return NextResponse.json({ error: "Step not found" }, { status: 404 });
  if (step.kind !== "email") {
    return NextResponse.json({ error: "Only email steps can be previewed" }, { status: 400 });
  }

  // Preview against a real recipient when one is given, else the first enrolled.
  let recipient = { email: "recipient@example.com", displayName: "Sample Recipient" } as {
    email: string;
    displayName: string | null;
    mergeFields?: Record<string, string> | null;
  };

  const { data: enrollment } = await ctx.svc
    .from("sequence_enrollments")
    .select("email, display_name, merge_fields")
    .eq("sequence_id", sequence.id)
    .neq("status", "removed")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  const chosen = body.enrollmentId
    ? (
        await ctx.svc
          .from("sequence_enrollments")
          .select("email, display_name, merge_fields")
          .eq("id", body.enrollmentId)
          .eq("sequence_id", sequence.id)
          .maybeSingle()
      ).data
    : enrollment;

  if (chosen) {
    recipient = {
      email: chosen.email as string,
      displayName: chosen.display_name as string | null,
      mergeFields: chosen.merge_fields as Record<string, string> | null,
    };
  }

  const built = buildStepEmail(
    {
      subjectTemplate: (step.subject_template as string) ?? "",
      bodyHtml: (step.body_html as string) ?? "",
      includeSignature: sequence.include_signature,
      signatureHtml: sequence.signature_html,
    },
    recipient,
  );

  return NextResponse.json({
    subject: built.subject,
    html: built.html,
    missing: built.missing,
    previewFor: recipient.email,
  });
}
