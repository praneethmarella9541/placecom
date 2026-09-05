import { NextResponse } from "next/server";

import { getUserOr401 } from "@/lib/request-auth";
import { resolveMailboxOwnerId } from "@/lib/team-scope";
import { listOrSeedStages } from "@/lib/crm-stages";
import { guessCompanyNameFromDomain } from "@/lib/company-name";
import { isPersonalEmailDomain } from "@/lib/personal-email-domains";

export const runtime = "nodejs";

const MAX_IMPORT = 100;

type DirectoryRow = {
  id: string;
  name: string;
  company: string | null;
  email: string | null;
  phone: string | null;
};

function companyFor(row: DirectoryRow): string {
  const explicit = row.company?.trim();
  if (explicit) return explicit;
  // Fall back to the email domain, but never label a lead "Gmail" — for a
  // personal address the person *is* the lead.
  const at = (row.email ?? "").lastIndexOf("@");
  if (at >= 0) {
    const domain = row.email!.slice(at + 1).trim().toLowerCase();
    if (domain && !isPersonalEmailDomain(domain)) return guessCompanyNameFromDomain(domain);
  }
  return row.name.trim() || "Untitled lead";
}

/**
 * POST /api/crm/leads/import — body: { contactIds: string[] }
 *
 * Turns contact-book rows into leads. This (plus the single-contact "Add to
 * CRM" action, which posts one id here) is the only way leads enter the
 * board: nothing is auto-imported from the mailbox, so the classifier's cost
 * stays bounded by what the user has deliberately added.
 *
 * New leads land in the board's unsorted column and are returned so the
 * caller can immediately kick off /api/crm/classify for exactly those ids.
 */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const mailboxOwnerId = await resolveMailboxOwnerId(supabase, user.id);
  if (!mailboxOwnerId) {
    return NextResponse.json(
      { error: "No CRM board yet — your account isn't linked to a team." },
      { status: 409 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as { contactIds?: unknown };
  if (
    !Array.isArray(body.contactIds) ||
    body.contactIds.length === 0 ||
    body.contactIds.some((v) => typeof v !== "string")
  ) {
    return NextResponse.json({ error: "contactIds must be a non-empty array" }, { status: 400 });
  }
  const contactIds = (body.contactIds as string[]).slice(0, MAX_IMPORT);

  const { data: contacts, error: contactsError } = await supabase
    .from("directory_contacts")
    .select("id, name, company, email, phone")
    .in("id", contactIds);
  if (contactsError) return NextResponse.json({ error: contactsError.message }, { status: 500 });

  const rows = (contacts ?? []) as DirectoryRow[];
  if (rows.length === 0) return NextResponse.json({ error: "No matching contacts" }, { status: 404 });

  // Skip contacts already on the board so re-importing a list is idempotent
  // rather than producing duplicate cards.
  const { data: existing } = await supabase
    .from("leads")
    .select("source_contact_id")
    .in("source_contact_id", rows.map((r) => r.id));
  const already = new Set(
    ((existing ?? []) as { source_contact_id: string | null }[])
      .map((e) => e.source_contact_id)
      .filter(Boolean) as string[]
  );

  const toInsert = rows.filter((r) => !already.has(r.id));
  if (toInsert.length === 0) {
    return NextResponse.json({ created: 0, skipped: rows.length, leadIds: [] });
  }

  const { stages } = await listOrSeedStages(supabase, mailboxOwnerId, user.id);
  const unsortedId = stages.find((s) => s.is_unsorted)?.id ?? null;

  const { data: inserted, error: insertError } = await supabase
    .from("leads")
    .insert(
      toInsert.map((r) => ({
        user_id: user.id,
        mailbox_owner_id: mailboxOwnerId,
        source_contact_id: r.id,
        company_name: companyFor(r),
        contact_name: r.name?.trim() || null,
        email: r.email?.trim() || null,
        phone: r.phone?.trim() || null,
        stage_id: unsortedId,
        stage_set_by: "ai",
        staff_name: "Unassigned",
      }))
    )
    .select("id");

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({
    created: inserted?.length ?? 0,
    skipped: rows.length - toInsert.length,
    leadIds: (inserted ?? []).map((l) => l.id as string),
  });
}
