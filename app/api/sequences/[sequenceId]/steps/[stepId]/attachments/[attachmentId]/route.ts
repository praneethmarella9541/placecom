import { NextResponse } from "next/server";

import { removeStepAttachmentFile } from "@/lib/sequence-attachments";
import {
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
} from "@/lib/sequence-server";

export const runtime = "nodejs";

type Params = { params: { sequenceId: string; stepId: string; attachmentId: string } };

/** DELETE /api/sequences/[id]/steps/[stepId]/attachments/[attachmentId] */
export async function DELETE(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  // Scoped by sequence as well as id: the path is user input, and the row
  // carries the storage key we're about to delete from.
  const { data: row } = await ctx.svc
    .from("sequence_step_attachments")
    .select("id, storage_path")
    .eq("id", params.attachmentId)
    .eq("step_id", params.stepId)
    .eq("sequence_id", sequence.id)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  const { error } = await ctx.svc
    .from("sequence_step_attachments")
    .delete()
    .eq("id", row.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await removeStepAttachmentFile(row.storage_path as string);

  return NextResponse.json({ deleted: true });
}
