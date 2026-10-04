import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import {
  MAIL_TEMPLATE_COLUMNS,
  rowToMailTemplate,
  validateMailTemplateInput,
} from "@/lib/mail-template-types";
import { stripVariableSpans } from "@/lib/compose-variables";

export const runtime = "nodejs";

/**
 * Saved mail templates, scoped to the caller.
 *
 * Reads and writes go through the caller's own session client rather than the
 * service role, so the per-user RLS policies in migration 0067 are the thing
 * actually enforcing ownership — the `user_id` filters below are belt as well
 * as braces. A route that bypassed RLS here would be the only thing standing
 * between one user's templates and another's.
 */

/** Rewritten by the table-missing check in both handlers. */
const MIGRATION_HINT = "Run migration 0067_mail_templates.sql to use templates.";

function isMissingTable(message: string): boolean {
  return /relation .*mail_templates.* does not exist|could not find the table/i.test(message);
}

/** Postgres unique-violation on mail_templates_user_name_key. */
function isDuplicateName(message: string): boolean {
  return /mail_templates_user_name_key|duplicate key/i.test(message);
}

/** GET /api/mail-templates — the caller's templates, most recently used first. */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("mail_templates")
    .select(MAIL_TEMPLATE_COLUMNS)
    .eq("user_id", user.id)
    // Matches mail_templates_user_recent_idx: what you reach for most comes
    // first, and a never-used template falls back to when it was last edited.
    .order("last_used_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });

  if (error) {
    // Before the migration the feature simply has nothing to show. An empty
    // list plus a flag lets the picker say so once instead of rendering an
    // error every time it opens.
    if (isMissingTable(error.message)) {
      return NextResponse.json({ templates: [], configured: false, error: MIGRATION_HINT });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    templates: (data ?? []).map((row) => rowToMailTemplate(row as never)),
    configured: true,
  });
}

/** POST /api/mail-templates — save the current draft as a new template. */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    subjectTemplate?: unknown;
    bodyHtml?: unknown;
  };

  const input = {
    name: typeof body.name === "string" ? body.name.trim() : "",
    subjectTemplate: typeof body.subjectTemplate === "string" ? body.subjectTemplate : "",
    // The editor wraps `{variable}` tokens in a tinting span for display. Those
    // are an editor affordance, re-applied on insert — storing them would bake
    // one editor's markup into the saved copy and leak it into any consumer
    // that renders the body as-is.
    bodyHtml: typeof body.bodyHtml === "string" ? stripVariableSpans(body.bodyHtml) : "",
  };

  const invalid = validateMailTemplateInput(input);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const { data, error } = await supabase
    .from("mail_templates")
    .insert({
      user_id: user.id,
      name: input.name,
      subject_template: input.subjectTemplate,
      body_html: input.bodyHtml,
    })
    .select(MAIL_TEMPLATE_COLUMNS)
    .single();

  if (error) {
    if (isMissingTable(error.message)) {
      return NextResponse.json({ error: MIGRATION_HINT }, { status: 503 });
    }
    if (isDuplicateName(error.message)) {
      return NextResponse.json(
        { error: "You already have a template with that name." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ template: rowToMailTemplate(data as never) }, { status: 201 });
}
