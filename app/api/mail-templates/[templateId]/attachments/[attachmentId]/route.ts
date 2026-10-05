import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import { removeTemplateFiles } from "@/lib/mail-template-attachments";

export const runtime = "nodejs";

type Params = { params: { templateId: string; attachmentId: string } };

/** DELETE /api/mail-templates/:id/attachments/:attachmentId */
export async function DELETE(request: Request, { params }: Params) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Scoped by template and owner as well as id: the row carries the storage
  // key about to be deleted, and the ids in the path are user input.
  const { data, error } = await supabase
    .from("mail_template_attachments")
    .delete()
    .eq("id", params.attachmentId)
    .eq("template_id", params.templateId)
    .eq("user_id", user.id)
    .select("storage_path")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Attachment not found" }, { status: 404 });

  // A Drive-linked file has no bytes here; it stays in the user's Drive, as
  // compose's Drive attachments do.
  const path = (data as { storage_path: string | null }).storage_path;
  if (path) await removeTemplateFiles([path]);
  return NextResponse.json({ ok: true });
}
