import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listPrimaryCalendarEvents } from "@/lib/google-calendar";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: { id: string } }) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: company, error: companyError } = await supabase
    .from("crm_companies")
    .select("domain")
    .eq("id", params.id)
    .eq("user_id", user.id)
    .single();

  if (companyError || !company) {
    return NextResponse.json({ error: "Company not found" }, { status: 404 });
  }

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const events = await listPrimaryCalendarEvents(auth.accessToken, {
      timeMin: new Date().toISOString(),
      maxResults: 250,
    });

    const domain = company.domain.toLowerCase();
    const match = events.find((event) =>
      (event.attendees || []).some((a) => (a.email || "").toLowerCase().endsWith(`@${domain}`))
    );

    return NextResponse.json({ event: match ?? null });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to load calendar";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
