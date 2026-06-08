import { NextResponse } from "next/server";
import { lookupContactPhotosByEmails } from "@/lib/google-people-contacts";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { emails?: unknown };
  try {
    body = (await request.json()) as { emails?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.emails;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "emails must be an array" }, { status: 400 });
  }

  const emails = raw
    .filter((e): e is string => typeof e === "string")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"))
    .slice(0, 20);

  if (!emails.length) {
    return NextResponse.json({ photos: {} });
  }

  try {
    const photos = await lookupContactPhotosByEmails(auth.accessToken, emails);
    return NextResponse.json({ photos }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Photo lookup failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
