import { NextResponse } from "next/server";

import {
  MAX_ATTACHMENTS_PER_STEP,
  MAX_ATTACHMENT_BYTES,
  MAX_STEP_ATTACHMENT_BYTES,
  removeStepAttachmentFile,
  toAttachmentDto,
  uploadStepAttachment,
  type AttachmentRow,
} from "@/lib/sequence-attachments";
import {
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
} from "@/lib/sequence-server";

export const runtime = "nodejs";

type Params = { params: { sequenceId: string; stepId: string } };

function mb(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

/**
 * POST /api/sequences/[id]/steps/[stepId]/attachments — attach one file.
 *
 * multipart/form-data with a single `file`, matching what the compose footer's
 * paperclip and photo buttons hand over. Sent as a real Gmail attachment on
 * every copy of this step, so the caps here are about what Gmail will accept
 * (25MB after base64 inflates it ~33%) rather than about storage.
 */
export async function POST(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const { data: step } = await ctx.svc
    .from("sequence_steps")
    .select("id, kind")
    .eq("id", params.stepId)
    .eq("sequence_id", sequence.id)
    .maybeSingle();

  if (!step) return NextResponse.json({ error: "Step not found" }, { status: 404 });
  if (step.kind !== "email") {
    return NextResponse.json({ error: "Only email steps take attachments" }, { status: 400 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "No file received" }, { status: 400 });
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    return NextResponse.json(
      { error: `"${file.name}" is larger than ${mb(MAX_ATTACHMENT_BYTES)}.` },
      { status: 400 },
    );
  }

  const { data: existing } = await ctx.svc
    .from("sequence_step_attachments")
    .select("id, size_bytes")
    .eq("step_id", step.id);

  const rows = (existing ?? []) as { id: string; size_bytes: number }[];
  if (rows.length >= MAX_ATTACHMENTS_PER_STEP) {
    return NextResponse.json(
      { error: `A step can carry at most ${MAX_ATTACHMENTS_PER_STEP} files.` },
      { status: 400 },
    );
  }
  const usedBytes = rows.reduce((sum, r) => sum + (r.size_bytes ?? 0), 0);
  if (usedBytes + file.size > MAX_STEP_ATTACHMENT_BYTES) {
    return NextResponse.json(
      { error: `That would put this step over ${mb(MAX_STEP_ATTACHMENT_BYTES)} of attachments.` },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const mimeType = file.type || "application/octet-stream";
  const filename = file.name.slice(0, 200) || "attachment";

  let storagePath: string;
  try {
    storagePath = await uploadStepAttachment({
      mailboxOwnerId: ctx.mailboxOwnerId,
      sequenceId: sequence.id,
      stepId: step.id,
      file: buffer,
      filename,
      mimeType,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Upload failed" },
      { status: 500 },
    );
  }

  const { data: inserted, error } = await ctx.svc
    .from("sequence_step_attachments")
    .insert({
      sequence_id: sequence.id,
      step_id: step.id,
      mailbox_owner_id: ctx.mailboxOwnerId,
      storage_path: storagePath,
      filename,
      mime_type: mimeType,
      size_bytes: buffer.length,
      created_by: ctx.userId,
    })
    .select("id, step_id, storage_path, filename, mime_type, size_bytes, created_at")
    .single();

  if (error || !inserted) {
    // Don't leave bytes behind that nothing points at.
    await removeStepAttachmentFile(storagePath);
    return NextResponse.json({ error: error?.message || "Could not save file" }, { status: 500 });
  }

  return NextResponse.json({ attachment: toAttachmentDto(inserted as AttachmentRow) });
}
