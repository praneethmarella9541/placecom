import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { isValidE164, normalizePhone } from "@/lib/phone";
import { isLikelyLinkedInUrl, normalizeLinkedInUrl } from "@/lib/contact-directory";
import type { DirectoryContact } from "@/lib/contact-directory";
import { findDuplicateContact } from "@/lib/directory-duplicate";

export const runtime = "nodejs";

type ContactInput = {
  name?: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  linkedin_url?: string;
  location?: string;
  tags?: string[];
  notes?: string;
  /** The user saw the duplicate warning and chose to save anyway. */
  allowDuplicate?: boolean;
};

/** GET /api/directory-contacts/[id] — single shared contact card */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("directory_contacts")
    .select("*")
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  // Same source_name/source_company enrichment the list route does, so the
  // detail page's LinkedIn link searches Gmail's name rather than whatever the
  // card was renamed to. One row by email here, not the whole table.
  const contact = data as DirectoryContact;
  if (contact.email) {
    const { data: synced } = await supabase
      .from("synced_contacts")
      .select("display_name, company_name")
      .ilike("email", contact.email.trim())
      .limit(1)
      .maybeSingle();
    contact.source_name = (synced?.display_name as string | null) ?? null;
    contact.source_company = (synced?.company_name as string | null) ?? null;
  }

  return NextResponse.json({ contact });
}

/** PATCH /api/directory-contacts/[id] — edit a shared contact card (any signed-in user) */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as ContactInput | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const updates: Partial<DirectoryContact> = {};

  // The saved card, to tell what this edit actually changes: values the user
  // didn't touch must not trigger the LinkedIn or duplicate checks, or editing
  // a company on a card that predates them would be refused.
  const { data: current } = await supabase
    .from("directory_contacts")
    .select("email, phone, linkedin_url")
    .eq("id", params.id)
    .maybeSingle();

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
    updates.name = name;
  }
  if (body.email !== undefined) {
    const email = body.email.trim();
    if (email && !isValidEmail(email)) {
      return NextResponse.json({ error: "Enter a valid email address" }, { status: 400 });
    }
    updates.email = email || null;
  }
  if (body.phone !== undefined) {
    const phoneRaw = body.phone.trim();
    if (phoneRaw && !isValidE164(phoneRaw)) {
      return NextResponse.json(
        { error: "Enter a valid mobile number, e.g. +918489431508 or 10 digits" },
        { status: 400 }
      );
    }
    updates.phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  }
  if (body.linkedin_url !== undefined) {
    const linkedinRaw = body.linkedin_url.trim();
    if (linkedinRaw) {
      const normalized = normalizeLinkedInUrl(linkedinRaw);
      if (normalized !== (current?.linkedin_url ?? null) && !isLikelyLinkedInUrl(normalized)) {
        return NextResponse.json({ error: "This isn't a LinkedIn link. Use linkedin.com/in/…" }, { status: 400 });
      }
      updates.linkedin_url = normalized;
    } else {
      updates.linkedin_url = null;
    }
  }
  if (body.company !== undefined) updates.company = body.company.trim() || null;
  if (body.title !== undefined) updates.title = body.title.trim() || null;
  if (body.location !== undefined) updates.location = body.location.trim() || null;
  if (body.notes !== undefined) updates.notes = body.notes.trim() || null;
  if (body.tags !== undefined) {
    updates.tags = body.tags.map((t) => t.trim()).filter(Boolean);
  }

  // Only an email/phone change can create a duplicate. The other half of the
  // pair may not be in the request, so fill it from the saved card.
  const emailChanged =
    updates.email !== undefined &&
    (updates.email ?? "").toLowerCase() !== (current?.email ?? "").trim().toLowerCase();
  const phoneChanged =
    updates.phone !== undefined &&
    (updates.phone ? normalizePhone(updates.phone) : "") !== (current?.phone ? normalizePhone(current.phone) : "");
  if (!body.allowDuplicate && (emailChanged || phoneChanged)) {
    const duplicate = await findDuplicateContact(
      supabase,
      {
        email: updates.email !== undefined ? updates.email : (current?.email ?? null),
        phone: updates.phone !== undefined ? updates.phone : (current?.phone ?? null),
      },
      params.id
    );
    if (duplicate) {
      return NextResponse.json(
        { error: "This contact is already in the directory", duplicate },
        { status: 409 }
      );
    }
  }

  const { data, error } = await supabase
    .from("directory_contacts")
    .update({ ...updates, updated_by: user.id, updated_at: new Date().toISOString() })
    .eq("id", params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data as DirectoryContact });
}

/** DELETE /api/directory-contacts/[id] — remove a shared contact card (any signed-in user) */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { error } = await supabase.from("directory_contacts").delete().eq("id", params.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
