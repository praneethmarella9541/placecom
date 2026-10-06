import { NextResponse } from "next/server";

import { formatMb } from "@/lib/mail-template-types";
import { GMAIL_ATTACHMENT_MAX_BYTES, sendsAsDriveLink } from "@/lib/gmail-draft-limits";
import {
  ATTACHMENT_ROW_COLUMNS,
  createStepUploadUrl,
  removeStepAttachmentFile,
  stepObjectSize,
  stepPathBelongsTo,
  toAttachmentDto,
  type AttachmentRow,
} from "@/lib/sequence-attachments";
import {
  getSequenceContext,
  isErrorResponse,
  loadOwnedSequence,
  notFound,
  type SequenceContext,
} from "@/lib/sequence-server";
import { isValidDriveLink } from "@/lib/storage-signed-upload";

export const runtime = "nodejs";

type Params = { params: { sequenceId: string; stepId: string } };

/**
 * Attaching a file to a sequence email step. Same rule as compose and mail
 * templates (sendsAsDriveLink): up to Gmail's 25 MB the file is stored and sent
 * as an attachment; past that it is a Google Drive link in the body. No total
 * or count cap.
 *
 *   POST  { filename, size }              → { path, token }   sign a direct upload
 *   (browser uploads to `path` with `token`)
 *   PUT   { path, filename, mimeType }    → { attachment }    re-check, record
 *   PUT   { driveFile: { id, name, mimeType, size, webViewLink } } → { attachment }
 *
 * The bytes go browser → storage, never through this route: a serverless
 * request body (4.5 MB on Vercel) is far below Gmail's 25 MB.
 */

function tooBigError(name: string, size: number): string {
  return `File size exceeded: "${name}" is ${formatMb(size)}, over Gmail's ${formatMb(GMAIL_ATTACHMENT_MAX_BYTES)} per-file limit, so it has to be shared as a Google Drive link.`;
}

async function loadStep(request: Request, params: Params["params"]) {
  const ctx = await getSequenceContext(request);
  if (isErrorResponse(ctx)) return { error: ctx } as const;

  const sequence = await loadOwnedSequence(ctx, params.sequenceId);
  if (!sequence) return { error: notFound() } as const;

  const { data: step } = await ctx.svc
    .from("sequence_steps")
    .select("id, kind")
    .eq("id", params.stepId)
    .eq("sequence_id", sequence.id)
    .maybeSingle();

  if (!step) {
    return { error: NextResponse.json({ error: "Step not found" }, { status: 404 }) } as const;
  }
  if (step.kind !== "email") {
    return {
      error: NextResponse.json({ error: "Only email steps take attachments" }, { status: 400 }),
    } as const;
  }
  return { ctx, sequenceId: sequence.id as string, stepId: step.id as string } as const;
}

async function insertRow(
  ctx: SequenceContext,
  sequenceId: string,
  stepId: string,
  row: Record<string, unknown>,
) {
  return ctx.svc
    .from("sequence_step_attachments")
    .insert({
      sequence_id: sequenceId,
      step_id: stepId,
      mailbox_owner_id: ctx.mailboxOwnerId,
      created_by: ctx.userId,
      ...row,
    })
    .select(ATTACHMENT_ROW_COLUMNS)
    .single();
}

/** POST — sign a direct upload for a file that will be sent as an attachment. */
export async function POST(request: Request, { params }: Params) {
  const loaded = await loadStep(request, params);
  if ("error" in loaded) return loaded.error;
  const { ctx, sequenceId, stepId } = loaded;

  const body = (await request.json().catch(() => ({}))) as { filename?: unknown; size?: unknown };
  const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!filename || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "No file received" }, { status: 400 });
  }
  if (sendsAsDriveLink(size)) {
    return NextResponse.json({ error: tooBigError(filename, size) }, { status: 413 });
  }

  try {
    const signed = await createStepUploadUrl({
      mailboxOwnerId: ctx.mailboxOwnerId,
      sequenceId,
      stepId,
      filename,
    });
    return NextResponse.json(signed);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not prepare the upload" },
      { status: 500 },
    );
  }
}

/** PUT — record an uploaded file, or a file already put on Drive and shared. */
export async function PUT(request: Request, { params }: Params) {
  const loaded = await loadStep(request, params);
  if ("error" in loaded) return loaded.error;
  const { ctx, sequenceId, stepId } = loaded;

  const body = (await request.json().catch(() => ({}))) as {
    path?: unknown;
    filename?: unknown;
    mimeType?: unknown;
    driveFile?: {
      id?: unknown;
      name?: unknown;
      mimeType?: unknown;
      size?: unknown;
      webViewLink?: unknown;
    };
  };

  if (body.driveFile && typeof body.driveFile === "object") {
    const f = body.driveFile;
    const id = typeof f.id === "string" ? f.id.trim() : "";
    const webViewLink = typeof f.webViewLink === "string" ? f.webViewLink.trim() : "";
    const size = Number(f.size);
    // The link goes into every mail this step sends, so it has to be a real
    // Drive URL rather than whatever the client sent.
    if (!isValidDriveLink(id, webViewLink) || !Number.isFinite(size) || size < 0) {
      return NextResponse.json({ error: "Unknown Drive file" }, { status: 400 });
    }
    const { data, error } = await insertRow(ctx, sequenceId, stepId, {
      drive_file_id: id,
      web_view_link: webViewLink,
      filename: (typeof f.name === "string" ? f.name.trim().slice(0, 200) : "") || "attachment",
      mime_type:
        (typeof f.mimeType === "string" ? f.mimeType.trim() : "") || "application/octet-stream",
      size_bytes: Math.round(size),
    });
    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Could not save file" }, { status: 500 });
    }
    return NextResponse.json({ attachment: toAttachmentDto(data as AttachmentRow) });
  }

  const path = typeof body.path === "string" ? body.path : "";
  const filename =
    (typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "") || "attachment";
  const mimeType =
    (typeof body.mimeType === "string" ? body.mimeType.trim() : "") || "application/octet-stream";

  // The path comes back from the client, so it must be one this step could
  // have been signed for — otherwise this would index someone else's file.
  if (!stepPathBelongsTo(path, ctx.mailboxOwnerId, sequenceId, stepId)) {
    return NextResponse.json({ error: "Unknown upload" }, { status: 400 });
  }

  // The size declared at signing time is only a promise; what landed counts.
  const size = await stepObjectSize(path);
  if (size === null) {
    return NextResponse.json(
      { error: `"${filename}" didn't finish uploading. Try attaching it again.` },
      { status: 409 },
    );
  }
  if (sendsAsDriveLink(size)) {
    await removeStepAttachmentFile(path);
    return NextResponse.json({ error: tooBigError(filename, size) }, { status: 413 });
  }

  const { data, error } = await insertRow(ctx, sequenceId, stepId, {
    storage_path: path,
    filename,
    mime_type: mimeType,
    size_bytes: size,
  });
  if (error || !data) {
    // Don't leave bytes behind that nothing points at.
    await removeStepAttachmentFile(path);
    return NextResponse.json({ error: error?.message || "Could not save file" }, { status: 500 });
  }

  return NextResponse.json({ attachment: toAttachmentDto(data as AttachmentRow) });
}
