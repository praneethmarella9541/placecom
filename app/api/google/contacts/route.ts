import { NextResponse } from "next/server";
import { fetchGoogleContactsDirectory, syncContactToGoogle } from "@/lib/google-people-contacts";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  try {
    const result = await fetchGoogleContactsDirectory(auth.accessToken);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Failed to load Google contacts";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

/** POST — push a single contact into the shared (mailbox owner's) Google Contacts. */
export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as { name?: string; phone?: string } | null;
  const name = body?.name?.trim();
  const phone = body?.phone?.trim();
  if (!name || !phone) {
    return NextResponse.json({ error: "name and phone are required" }, { status: 400 });
  }

  const result = await syncContactToGoogle(auth.accessToken, name, phone);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: result.status });
  }
  return NextResponse.json({ ok: true, action: result.action });
}
