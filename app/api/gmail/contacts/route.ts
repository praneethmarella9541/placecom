import { NextResponse } from "next/server";
import { fetchGoogleContactsForCompose } from "@/lib/google-people-contacts";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const { contacts, photoByEmail, mePhotoUrl, hint } = await fetchGoogleContactsForCompose(auth.accessToken);
    return NextResponse.json({
      contacts,
      photoByEmail,
      ...(mePhotoUrl ? { mePhotoUrl } : {}),
      ...(hint ? { hint } : {}),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load Google contacts";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
