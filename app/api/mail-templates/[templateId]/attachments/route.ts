import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import {
  ATTACHMENT_MIGRATION_HINT,
  createTemplateUploadUrl,
  isMissingAttachmentTable,
  isValidDriveLink,
  loadTemplateFiles,
  pathBelongsTo,
  removeTemplateFiles,
  templateObjectSize,
} from "@/lib/mail-template-attachments";
import {
  MAIL_TEMPLATE_ATTACHMENT_COLUMNS,
  storedAttachmentError,
  rowToMailTemplateAttachment,
  type MailTemplateAttachmentRow,
} from "@/lib/mail-template-types";

export const runtime = "nodejs";

type Params = { params: { templateId: string } };

/**
 * Attaching a file is two calls with the upload in between, because the bytes
 * go from the browser straight to storage (see lib/mail-template-attachments):
 *
 *   POST  { filename, mimeType, size }  → { path, token }   checks the limit, signs
 *   (browser uploads to `path` with `token`)
 *   PUT   { path, filename, mimeType }  → { attachment }    re-checks, records
 *
 * A file over Gmail's 25 MB skips the bucket (sendsAsDriveLink): the browser
 * puts it on Drive the way compose does, then records the link with
 *
 *   PUT   { driveFile: { id, name, mimeType, size, webViewLink } } → { attachment }
 */


async function loadContext(request: Request, templateId: string) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  }

  const { data: template, error } = await supabase
    .from("mail_templates")
    .select("id")
    .eq("id", templateId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) return { error: NextResponse.json({ error: error.message }, { status: 500 }) } as const;
  if (!template) {
    return { error: NextResponse.json({ error: "Template not found" }, { status: 404 }) } as const;
  }

  const files = await loadTemplateFiles(supabase, user.id, templateId);
  if (files.error) {
    return { error: NextResponse.json({ error: files.error }, { status: 500 }) } as const;
  }
  // Refuse before anything is uploaded, not after the bytes are already in.
  if (files.missingTable) {
    return {
      error: NextResponse.json({ error: ATTACHMENT_MIGRATION_HINT }, { status: 503 }),
    } as const;
  }
  return { supabase, user } as const;
}

/** POST — check a file fits, then sign an upload URL for it. */
export async function POST(request: Request, { params }: Params) {
  const ctx = await loadContext(request, params.templateId);
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => ({}))) as {
    filename?: unknown;
    size?: unknown;
  };
  const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!filename || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "No file received" }, { status: 400 });
  }

  const tooBig = storedAttachmentError(filename, size);
  if (tooBig) return NextResponse.json({ error: tooBig }, { status: 413 });

  try {
    const signed = await createTemplateUploadUrl({
      userId: ctx.user.id,
      templateId: params.templateId,
      filename,
    });
    return NextResponse.json(signed);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not prepare the upload" },
      { status: 500 }
    );
  }
}

/** PUT — record a file the browser has finished uploading. */
export async function PUT(request: Request, { params }: Params) {
  const ctx = await loadContext(request, params.templateId);
  if ("error" in ctx) return ctx.error;

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
    return recordDriveLink(ctx, params.templateId, body.driveFile);
  }
  const path = typeof body.path === "string" ? body.path : "";
  const filename =
    (typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "") || "attachment";
  const mimeType =
    (typeof body.mimeType === "string" ? body.mimeType.trim() : "") || "application/octet-stream";

  // The path comes back from the client, so it must be one this user could
  // have been signed for — otherwise this would index someone else's file.
  if (!pathBelongsTo(path, ctx.user.id, params.templateId)) {
    return NextResponse.json({ error: "Unknown upload" }, { status: 400 });
  }

  // The size declared at signing time is only a promise. What actually landed
  // is what counts against the limit.
  const size = await templateObjectSize(path);
  if (size === null) {
    return NextResponse.json(
      { error: `"${filename}" didn't finish uploading. Try attaching it again.` },
      { status: 409 }
    );
  }
  const tooBig = storedAttachmentError(filename, size);
  if (tooBig) {
    await removeTemplateFiles([path]);
    return NextResponse.json({ error: tooBig }, { status: 413 });
  }

  const { data, error } = await ctx.supabase
    .from("mail_template_attachments")
    .insert({
      template_id: params.templateId,
      user_id: ctx.user.id,
      storage_path: path,
      filename,
      mime_type: mimeType,
      size_bytes: size,
    })
    .select(MAIL_TEMPLATE_ATTACHMENT_COLUMNS)
    .single();

  if (error || !data) {
    // Don't leave bytes behind that nothing points at.
    await removeTemplateFiles([path]);
    if (error && isMissingAttachmentTable(error.message)) {
      return NextResponse.json({ error: ATTACHMENT_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: error?.message || "Could not save file" }, { status: 500 });
  }

  return NextResponse.json({
    attachment: rowToMailTemplateAttachment(data as MailTemplateAttachmentRow),
  });
}

type Ctx = Exclude<Awaited<ReturnType<typeof loadContext>>, { error: unknown }>;

/** Record a file the browser has already put on Drive and shared. */
async function recordDriveLink(
  ctx: Ctx,
  templateId: string,
  file: { id?: unknown; name?: unknown; mimeType?: unknown; size?: unknown; webViewLink?: unknown }
) {
  const id = typeof file.id === "string" ? file.id.trim() : "";
  const webViewLink = typeof file.webViewLink === "string" ? file.webViewLink.trim() : "";
  const filename =
    (typeof file.name === "string" ? file.name.trim().slice(0, 200) : "") || "attachment";
  const mimeType =
    (typeof file.mimeType === "string" ? file.mimeType.trim() : "") || "application/octet-stream";
  const size = Number(file.size);

  // The link is pasted into every mail that uses the template, so it has to
  // be a real Drive URL rather than whatever the client sent.
  if (!isValidDriveLink(id, webViewLink) || !Number.isFinite(size) || size < 0) {
    return NextResponse.json({ error: "Unknown Drive file" }, { status: 400 });
  }

  const { data, error } = await ctx.supabase
    .from("mail_template_attachments")
    .insert({
      template_id: templateId,
      user_id: ctx.user.id,
      drive_file_id: id,
      web_view_link: webViewLink,
      filename,
      mime_type: mimeType,
      size_bytes: Math.round(size),
    })
    .select(MAIL_TEMPLATE_ATTACHMENT_COLUMNS)
    .single();

  if (error || !data) {
    if (error && isMissingAttachmentTable(error.message)) {
      return NextResponse.json({ error: ATTACHMENT_MIGRATION_HINT }, { status: 503 });
    }
    return NextResponse.json({ error: error?.message || "Could not save file" }, { status: 500 });
  }

  return NextResponse.json({
    attachment: rowToMailTemplateAttachment(data as MailTemplateAttachmentRow),
  });
}
