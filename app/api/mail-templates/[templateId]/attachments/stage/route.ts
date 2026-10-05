import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import { appendStagedChunk, createStagedUpload } from "@/lib/draft-attachment-staging";
import type { PendingFile } from "@/lib/gmail-compose-types";
import { downloadTemplateFile, loadTemplateFiles } from "@/lib/mail-template-attachments";
import { createServiceSupabase } from "@/lib/supabase-service";

export const runtime = "nodejs";
export const maxDuration = 120;

type Params = { params: { templateId: string } };

/**
 * POST /api/mail-templates/:id/attachments/stage
 * Body: { attachmentIds?: string[] }
 *
 * Turns a template's files into compose pending files. Stored files (each at
 * most 25 MB, by the shared rule) are copied into compose's attachment staging
 * as `staged` files, so the send and draft-save routes need no new path.
 * Drive-linked files come back as `drive` files, which compose already sends
 * as links in the body.
 */
export async function POST(request: Request, { params }: Params) {
  // Staging is keyed by the signed-in user's id — the same id the send route
  // looks staged uploads up by. Only the session is needed here, not a Google
  // token, which would cost a round trip to Google on every copy.
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const auth = { userId: user.id };

  const body = (await request.json().catch(() => ({}))) as {
    attachmentIds?: unknown;
  };
  const only = Array.isArray(body.attachmentIds)
    ? new Set(body.attachmentIds.filter((x): x is string => typeof x === "string"))
    : null;

  const svc = createServiceSupabase();
  const { data: template } = await svc
    .from("mail_templates")
    .select("id")
    .eq("id", params.templateId)
    .eq("user_id", auth.userId)
    .maybeSingle();
  if (!template) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const { rows, error } = await loadTemplateFiles(svc, auth.userId, params.templateId);
  if (error) return NextResponse.json({ error }, { status: 500 });

  const files: PendingFile[] = [];

  for (const row of rows) {
    if (only && !only.has(row.id)) continue;
    const mimeType = row.mime_type || "application/octet-stream";

    if (!row.storage_path) {
      if (!row.drive_file_id || !row.web_view_link) continue;
      files.push({
        kind: "drive",
        name: row.filename,
        mimeType,
        size: row.size_bytes,
        driveFileId: row.drive_file_id,
        webViewLink: row.web_view_link,
      });
      continue;
    }

    const buffer = await downloadTemplateFile(row.storage_path);
    // All or nothing: a template applied without one of its files would send
    // a mail that silently differs from the one the user saved.
    if (!buffer) {
      return NextResponse.json(
        { error: `"${row.filename}" could not be loaded from this template. Remove it and attach it again.` },
        { status: 502 }
      );
    }

    try {
      const uploadId = createStagedUpload(auth.userId, row.filename, mimeType, buffer.length);
      await appendStagedChunk(auth.userId, uploadId, 0, buffer);
      files.push({ kind: "staged", uploadId, name: row.filename, mimeType, size: buffer.length });
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : `Could not attach "${row.filename}"` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ files });
}
