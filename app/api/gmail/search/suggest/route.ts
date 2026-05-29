import { NextResponse } from "next/server";
import { listThreadSearchSuggestions } from "@/lib/gmail-search-suggest";
import { searchContactsByQuery } from "@/lib/google-people-contacts";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (q.length < 1) {
    return NextResponse.json({ contacts: [], threads: [] });
  }

  try {
    const [contacts, threads] = await Promise.all([
      searchContactsByQuery(auth.accessToken, q),
      listThreadSearchSuggestions(auth.accessToken, q, 6),
    ]);

    const qLower = q.toLowerCase();
    let completionEmail: string | undefined;
    for (const c of contacts) {
      if (c.email.toLowerCase().startsWith(qLower) && c.email.length > q.length) {
        completionEmail = c.email;
        break;
      }
    }

    return NextResponse.json(
      { contacts, threads, completionEmail },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Suggest failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
