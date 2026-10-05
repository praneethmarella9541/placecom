import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import {
  MAIL_TEMPLATE_COLUMNS,
  rowToMailTemplate,
  validateMailTemplateInput,
} from "@/lib/mail-template-types";
import { stripVariableSpans } from "@/lib/compose-variables";
import {
  loadAttachmentsByTemplate,
  loadTemplateFiles,
  removeTemplateFiles,
  storedPaths,
} from "@/lib/mail-template-attachments";

export const runtime = "nodejs";

type Params = { params: { templateId: string } };

/** Postgres unique-violation on mail_templates_user_name_key. */
function isDuplicateName(message: string): boolean {
  return /mail_templates_user_name_key|duplicate key/i.test(message);
}

/**
 * PATCH /api/mail-templates/:id
 *
 * Carries two unrelated jobs so the picker needs one endpoint rather than two:
 * editing a template (rename, or overwrite it with the current draft), and
 * recording that it was just inserted (`touch`). The second is why this is not
 * a strict PUT — the client fires it on every insert and sends no content.
 */
export async function PATCH(request: Request, { params }: Params) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    subjectTemplate?: unknown;
    bodyHtml?: unknown;
    touch?: unknown;
  };

  // The row has to exist and be this user's before anything else: the
  // ownership filter on the update below would turn someone else's id into a
  // silent no-op, which reads to the user as "nothing happened".
  const { data: existing, error: loadError } = await supabase
    .from("mail_templates")
    .select(MAIL_TEMPLATE_COLUMNS)
    .eq("id", params.templateId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (loadError) return NextResponse.json({ error: loadError.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  const current = rowToMailTemplate(existing as never);

  // A touch is bookkeeping, not an edit: it moves the template up the picker's
  // order without claiming the content changed, so updated_at stays put.
  if (body.touch === true) {
    const { error } = await supabase
      .from("mail_templates")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", params.templateId)
      .eq("user_id", user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  // Absent fields keep their stored value, so a rename does not have to resend
  // the body and an overwrite does not have to resend the name.
  const input = {
    name: typeof body.name === "string" ? body.name.trim() : current.name,
    subjectTemplate:
      typeof body.subjectTemplate === "string" ? body.subjectTemplate : current.subjectTemplate,
    bodyHtml:
      typeof body.bodyHtml === "string" ? stripVariableSpans(body.bodyHtml) : current.bodyHtml,
  };

  const invalid = validateMailTemplateInput(input);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { data, error } = await supabase
    .from("mail_templates")
    .update({
      name: input.name,
      subject_template: input.subjectTemplate,
      body_html: input.bodyHtml,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.templateId)
    .eq("user_id", user.id)
    .select(MAIL_TEMPLATE_COLUMNS)
    .single();

  if (error) {
    if (isDuplicateName(error.message)) {
      return NextResponse.json(
        { error: "You already have a template with that name." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The response replaces the client's cached copy, so it has to carry the
  // files too or an edit would make them vanish from the picker.
  const files = await loadAttachmentsByTemplate(supabase, user.id, [params.templateId]);
  return NextResponse.json({
    template: rowToMailTemplate(data as never, files.get(params.templateId) ?? []),
  });
}

/** DELETE /api/mail-templates/:id */
export async function DELETE(request: Request, { params }: Params) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Rows cascade with the template, but storage has no foreign keys — read
  // where the files are while the rows still say so.
  const { rows: files } = await loadTemplateFiles(supabase, user.id, params.templateId);

  // Returns the deleted row so a missing id is a 404 rather than a success that
  // deleted nothing — the two are indistinguishable from the client otherwise.
  const { data, error } = await supabase
    .from("mail_templates")
    .delete()
    .eq("id", params.templateId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Template not found" }, { status: 404 });

  // Drive-linked files stay in the user's Drive, as compose's do.
  await removeTemplateFiles(storedPaths(files));
  return NextResponse.json({ ok: true });
}
