import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { syncCompaniesFromMailbox } from "@/lib/company-mailbox-sync";

export const runtime = "nodejs";
// Full-mailbox scans can take minutes — same budget as /api/fetch-emails and /api/extract.
export const maxDuration = 300;

export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = await request.json().catch(() => ({}));
  const maxEmails: number | "all" =
    typeof body.maxEmails === "number" ? body.maxEmails : "all";

  try {
    const summary = await syncCompaniesFromMailbox(supabase, user.id, auth.accessToken, {
      gmailAddress: auth.gmailAddress,
      maxEmails,
    });
    return NextResponse.json(summary);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to sync companies from mailbox";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
