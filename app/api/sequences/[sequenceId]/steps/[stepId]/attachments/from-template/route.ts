import { NextResponse } from "next/server";

import { downloadTemplateFile, loadTemplateFiles } from "@/lib/mail-template-attachments";
import {
  ATTACHMENT_ROW_COLUMNS,
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
export const maxDuration = 120;

type Params = { params: { sequenceId: string; stepId: string } };

/**
 * POST /api/sequences/:id/steps/:stepId/attachments/from-template
 * Body: { templateId }
 *
 * Copies a mail template's files onto the step, so the step keeps them even if
 * the template is later edited or deleted. Templates and steps follow the same
 * attachment rule (sendsAsDriveLink), so this is a straight copy: stored files
 * become stored step files, Drive links stay Drive links. All or nothing.
 */
export async function POST(request: Request, { params }: Params) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return notFound();

  const body = (await request.json().catch(() => ({}))) as { templateId?: unknown };
  const templateId = typeof body.templateId === "string" ? body.templateId : "";
  if (!templateId) return NextResponse.json({ error: "No template given" }, { status: 400 });

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

  // Templates are personal: only the person using the editor can pull theirs in.
  const { data: template } = await ctx.svc
    .from("mail_templates")
    .select("id")
    .eq("id", templateId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const files = await loadTemplateFiles(ctx.svc, ctx.userId, templateId);
  if (files.error) return NextResponse.json({ error: files.error }, { status: 500 });

  const added: AttachmentRow[] = [];
  const fail = async (status: number, error: string) => {
    // Leave the step as it was rather than holding half a template's files.
    if (added.length > 0) {
      await ctx.svc
        .from("sequence_step_attachments")
        .delete()
        .in("id", added.map((a) => a.id));
      await Promise.all(added.map((a) => removeStepAttachmentFile(a.storage_path)));
    }
    return NextResponse.json({ error }, { status });
  };

  const base = {
    sequence_id: sequence.id,
    step_id: step.id,
    mailbox_owner_id: ctx.mailboxOwnerId,
    created_by: ctx.userId,
  };

  for (const file of files.rows) {
    const mimeType = file.mime_type || "application/octet-stream";
    let row: Record<string, unknown>;
    let storagePath: string | null = null;

    if (!file.storage_path) {
      if (!file.drive_file_id || !file.web_view_link) continue;
      row = {
        ...base,
        drive_file_id: file.drive_file_id,
        web_view_link: file.web_view_link,
        filename: file.filename,
        mime_type: mimeType,
        size_bytes: file.size_bytes,
      };
    } else {
      const buffer = await downloadTemplateFile(file.storage_path);
      if (!buffer) {
        return fail(
          502,
          `"${file.filename}" could not be loaded from the template. Remove it there and attach it again.`,
        );
      }
      try {
        storagePath = await uploadStepAttachment({
          mailboxOwnerId: ctx.mailboxOwnerId,
          sequenceId: sequence.id,
          stepId: step.id,
          file: buffer,
          filename: file.filename,
          mimeType,
        });
      } catch (e) {
        return fail(500, e instanceof Error ? e.message : "Upload failed");
      }
      row = {
        ...base,
        storage_path: storagePath,
        filename: file.filename,
        mime_type: mimeType,
        size_bytes: buffer.length,
      };
    }

    const { data: inserted, error } = await ctx.svc
      .from("sequence_step_attachments")
      .insert(row)
      .select(ATTACHMENT_ROW_COLUMNS)
      .single();

    if (error || !inserted) {
      await removeStepAttachmentFile(storagePath);
      return fail(500, error?.message || "Could not save file");
    }
    added.push(inserted as AttachmentRow);
  }

  return NextResponse.json({ attachments: added.map(toAttachmentDto) });
}
