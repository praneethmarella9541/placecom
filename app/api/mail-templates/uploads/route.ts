import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import {
  createUserUploadUrl,
  isUserUploadPath,
  removeTemplateFiles,
} from "@/lib/mail-template-attachments";
import { storedAttachmentError } from "@/lib/mail-template-types";

export const runtime = "nodejs";

/**
 * Uploads for the template editor, which starts sending a file the moment it is
 * picked — with a progress row, like compose — rather than waiting for Save.
 * A new template has no id yet, so the file goes to the user's uploads folder;
 * Save records it against the template (PUT /api/mail-templates/:id/attachments).
 *
 *   POST   { filename, size } → { path, signedUrl }   check the size, sign an upload
 *   DELETE { path }                                   drop an upload that was never saved
 */

export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { filename?: unknown; size?: unknown };
  const filename = typeof body.filename === "string" ? body.filename.trim().slice(0, 200) : "";
  const size = typeof body.size === "number" ? body.size : NaN;
  if (!filename || !Number.isFinite(size) || size <= 0) {
    return NextResponse.json({ error: "No file received" }, { status: 400 });
  }
  const tooBig = storedAttachmentError(filename, size);
  if (tooBig) return NextResponse.json({ error: tooBig }, { status: 413 });

  try {
    const signed = await createUserUploadUrl({ userId: user.id, filename });
    return NextResponse.json(signed);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Could not prepare the upload" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as { path?: unknown };
  const path = typeof body.path === "string" ? body.path : "";
  if (!isUserUploadPath(path, user.id)) {
    return NextResponse.json({ error: "Unknown upload" }, { status: 400 });
  }

  // Never delete bytes a saved template still points at — that row's own
  // delete is what removes them.
  const { data: inUse } = await supabase
    .from("mail_template_attachments")
    .select("id")
    .eq("user_id", user.id)
    .eq("storage_path", path)
    .limit(1);
  if ((inUse ?? []).length > 0) return NextResponse.json({ ok: true, kept: true });

  await removeTemplateFiles([path]);
  return NextResponse.json({ ok: true });
}
