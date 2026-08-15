import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { isValidE164, normalizePhone, phoneLookupVariants } from "@/lib/phone";
import { isValidUrl, normalizeLinkedInUrl } from "@/lib/contact-directory";
import type { DirectoryContact } from "@/lib/contact-directory";
import { buildLeadMatchMaps } from "@/lib/lead-contact-match";
import { fetchAllRows } from "@/lib/supabase-fetch-all";

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

type ValidationResult =
  | { ok: false; error: string }
  | { ok: true; clean: Partial<DirectoryContact> };

/** Shared fields validation, used by both create and update. */
function validateFields(body: ContactInput): ValidationResult {
  const clean: Partial<DirectoryContact> = {};

  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name) return { ok: false, error: "Name is required" };
    clean.name = name;
  }

  if (body.email !== undefined) {
    const email = body.email.trim();
    if (email && !isValidEmail(email)) return { ok: false, error: "Enter a valid email address" };
    clean.email = email || null;
  }

  if (body.phone !== undefined) {
    const phoneRaw = body.phone.trim();
    if (phoneRaw && !isValidE164(phoneRaw)) {
      return { ok: false, error: "Enter a valid mobile number, e.g. +918489431508 or 10 digits" };
    }
    clean.phone = phoneRaw ? normalizePhone(phoneRaw) : null;
  }

  if (body.linkedin_url !== undefined) {
    const linkedinRaw = body.linkedin_url.trim();
    if (linkedinRaw) {
      const normalized = normalizeLinkedInUrl(linkedinRaw);
      if (!isValidUrl(normalized)) return { ok: false, error: "Enter a valid LinkedIn URL" };
      clean.linkedin_url = normalized;
    } else {
      clean.linkedin_url = null;
    }
  }

  if (body.company !== undefined) clean.company = body.company.trim() || null;
  if (body.title !== undefined) clean.title = body.title.trim() || null;
  if (body.location !== undefined) clean.location = body.location.trim() || null;
  if (body.notes !== undefined) clean.notes = body.notes.trim() || null;
  if (body.tags !== undefined) {
    clean.tags = body.tags.map((t) => t.trim()).filter(Boolean);
  }

  return { ok: true, clean };
}

/** GET /api/directory-contacts — contact directory scoped to the caller's admin mailbox team (RLS via mailbox_owner_id) */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Org-wide, unfiltered — will keep growing, so this must page through
  // everything (see lib/supabase-fetch-all.ts) rather than a plain .select(),
  // which silently caps at 1000 rows (bit synced_contacts once it crossed that).
  const { data, error } = await fetchAllRows<DirectoryContact>((from, to) =>
    supabase
      .from("directory_contacts")
      .select("*")
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );

  if (error) {
    if (/relation.*directory_contacts.*does not exist/i.test(error)) {
      return NextResponse.json({ contacts: [] });
    }
    return NextResponse.json({ error }, { status: 500 });
  }

  const contacts = data;

  // "Last Contacted" = the more recent of the mailbox-sync's last real interaction
  // (matched by email) or when this card was last edited — a lightweight stand-in,
  // not a stored column, so it stays correct as synced_contacts keeps updating.
  const emails = contacts.map((c) => c.email).filter((e): e is string => !!e);
  const lastInteractionByEmail = new Map<string, string>();
  if (emails.length > 0) {
    const { data: synced } = await supabase
      .from("synced_contacts")
      .select("email, last_interaction_at")
      .in("email", emails);
    for (const row of synced ?? []) {
      if (row.last_interaction_at) lastInteractionByEmail.set(row.email, row.last_interaction_at);
    }
  }

  // Status column = derived from a matching CRM lead (by email, then phone) — one
  // batched query instead of a per-row lookup. See lib/lead-contact-match.ts.
  const { byEmail, byPhone } = await buildLeadMatchMaps(supabase);

  const enriched = contacts.map((c) => {
    const synced = c.email ? lastInteractionByEmail.get(c.email) : undefined;
    const last_contacted_at = synced && synced > c.updated_at ? synced : c.updated_at;

    let lead = c.email ? byEmail.get(c.email.trim().toLowerCase()) : undefined;
    if (!lead && c.phone) {
      for (const v of phoneLookupVariants(normalizePhone(c.phone))) {
        lead = byPhone.get(v);
        if (lead) break;
      }
    }

    return { ...c, last_contacted_at, lead_stage: lead?.stage ?? null, lead_score: lead?.score ?? null };
  });

  return NextResponse.json({ contacts: enriched });
}

/** POST /api/directory-contacts — create a new shared contact card */
export async function POST(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as ContactInput | null;
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  if (!body.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  const validated = validateFields(body);
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", user.id)
    .maybeSingle();
  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });
  const mailboxOwnerId = profile?.role === "admin" ? user.id : profile?.mailbox_owner_id;
  if (!mailboxOwnerId) {
    return NextResponse.json(
      { error: "Your account is not linked to an admin mailbox yet." },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("directory_contacts")
    .insert({
      ...validated.clean,
      created_by: user.id,
      updated_by: user.id,
      mailbox_owner_id: mailboxOwnerId,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ contact: data as DirectoryContact });
}
