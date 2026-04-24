import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

type RecruiterSuggestion = {
  email: string;
  name: string;
  companyName: string;
  source: "extracted_contacts";
};

export async function GET() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("email_extractions")
    .select("sender, extracted_contacts")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(300);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const map = new Map<string, RecruiterSuggestion>();
  for (const row of data || []) {
    const sender = String(row.sender || "").trim();
    const fromDomain = sender.includes("@")
      ? sender.split("@")[1].replace(/[>"]/g, "").toLowerCase()
      : "";
    const inferredCompany = fromDomain
      ? fromDomain.split(".")[0].replace(/[-_]/g, " ")
      : "";

    const contacts = Array.isArray(row.extracted_contacts)
      ? row.extracted_contacts
      : [];
    for (const c of contacts) {
      if (!c || typeof c !== "object") continue;
      const email = String((c as { email?: string }).email || "")
        .trim()
        .toLowerCase();
      if (!email || map.has(email)) continue;
      const name = String((c as { name?: string }).name || "").trim() || email;
      const companyName = inferredCompany || "Unknown Company";
      map.set(email, {
        email,
        name,
        companyName,
        source: "extracted_contacts",
      });
    }
  }

  return NextResponse.json({ recruiters: Array.from(map.values()).slice(0, 200) });
}
