import { NextResponse } from "next/server";
import { fetchGoogleContactsForCompose } from "@/lib/google-people-contacts";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

export async function GET() {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const { contacts, hint } = await fetchGoogleContactsForCompose(auth.accessToken);
    return NextResponse.json({ contacts, ...(hint ? { hint } : {}) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load Google contacts";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
