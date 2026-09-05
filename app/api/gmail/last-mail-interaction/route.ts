import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listThreadsPage } from "@/lib/gmail-inbox";
import { gmailAddressQuery } from "@/lib/gmail-address-query";

export const runtime = "nodejs";

/** Matches the mass-send row cap — asking for more than a campaign can hold is pointless. */
const MAX_EMAILS = 80;
/** Gmail throttles hard on parallel searches; five in flight keeps a 50-name lookup quick without 429s. */
const CONCURRENCY = 5;

/**
 * POST /api/gmail/last-mail-interaction — { emails } → { dates: { email: iso } }
 *
 * The date of the newest thread exchanged with each address, which is exactly
 * what the contact's Emails tab lists (same `gmailAddressQuery` over all mail,
 * see app/api/directory-contacts/[id]/timeline/route.ts). Used to fill the
 * {last_mail_interaction} merge variable, where the directory card's
 * "last contacted" is the wrong number — that one also moves when someone
 * merely edits the card.
 *
 * Addresses with no mail are simply absent from `dates` rather than mapped to
 * null, so the caller's "no value" handling is the same as for any other
 * empty merge field.
 */
export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  // Bound outside the workers — the narrowing from `auth.ok` above does not
  // survive into a closure.
  const accessToken = auth.accessToken;
  const mailboxKey = auth.mailboxOwnerId;

  let body: { emails?: unknown };
  try {
    body = (await request.json()) as { emails?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!Array.isArray(body.emails)) {
    return NextResponse.json({ error: "emails must be an array" }, { status: 400 });
  }

  const emails = Array.from(
    new Set(
      body.emails
        .filter((e): e is string => typeof e === "string")
        .map((e) => e.trim().toLowerCase())
        .filter((e) => e.includes("@"))
    )
  ).slice(0, MAX_EMAILS);

  if (emails.length === 0) return NextResponse.json({ dates: {} });

  const dates: Record<string, string> = {};
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= emails.length) return;
      const email = emails[i];
      try {
        // One thread is enough — Gmail returns them newest first.
        const page = await listThreadsPage(accessToken, {
          folder: "allmail",
          maxResults: 1,
          searchQuery: gmailAddressQuery(email),
          mailboxKey,
        });
        const at = page.threads[0]?.date;
        if (at) dates[email] = at;
      } catch {
        // A single address failing (bad query, transient 5xx) must not sink
        // the batch — it just resolves to no value, like an address with no
        // mail history.
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, emails.length) }, () => worker())
  );

  return NextResponse.json({ dates });
}
