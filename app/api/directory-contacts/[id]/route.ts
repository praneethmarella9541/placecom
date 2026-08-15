import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { isValidE164, normalizePhone } from "@/lib/phone";
import { isValidUrl, normalizeLinkedInUrl } from "@/lib/contact-directory";
import type { DirectoryContact } from "@/lib/contact-directory";

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
  return NextResponse.json({ contact: data as DirectoryContact });
}

/** PATCH /api/directory-contacts/[id] — edit a shared contact card (any signed-in user) */
export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as ContactInput | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const updates: Partial<DirectoryContact> = {};

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
      if (!isValidUrl(normalized)) {
        return NextResponse.json({ error: "Enter a valid LinkedIn URL" }, { status: 400 });
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
