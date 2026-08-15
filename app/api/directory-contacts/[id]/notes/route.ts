import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";

export const runtime = "nodejs";

export type ContactNoteRow = {
  id: string;
  contact_id: string;
  kind: "note" | "call";
  body: string;
  created_by: string | null;
  created_at: string;
};

/** GET /api/directory-contacts/[id]/notes — notes + quick-logged calls for a contact, shared org-wide */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("crm_contact_notes")
    .select("*")
    .eq("contact_id", params.id)
    .order("created_at", { ascending: false });

  if (error) {
    if (/relation.*crm_contact_notes.*does not exist/i.test(error.message)) {
      return NextResponse.json({ notes: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notes: (data ?? []) as ContactNoteRow[] });
}

/** POST /api/directory-contacts/[id]/notes — add a note (or a quick-logged call) */
export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { body?: string; kind?: "note" | "call" } | null;
  const text = body?.body?.trim();
  if (!text) return NextResponse.json({ error: "Note text is required" }, { status: 400 });

  const { data, error } = await supabase
    .from("crm_contact_notes")
    .insert({
      contact_id: params.id,
      kind: body?.kind === "call" ? "call" : "note",
      body: text,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data as ContactNoteRow });
}
