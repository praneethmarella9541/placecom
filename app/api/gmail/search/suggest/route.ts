import { NextResponse } from "next/server";
import {
  listThreadSearchSuggestions,
  pickEmailCompletion,
  suggestEmailsFromThreads,
} from "@/lib/gmail-search-suggest";
import { searchContactsByQuery } from "@/lib/google-people-contacts";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { SUGGEST_SCOPE_RE } from "@/lib/mail-search-scope";

export const runtime = "nodejs";

type SuggestContact = { email: string; displayName?: string; photoUrl?: string };

function mergeContacts(
  people: SuggestContact[],
  fromThreads: SuggestContact[],
  max = 6,
): SuggestContact[] {
  const seen = new Set<string>();
  const out: SuggestContact[] = [];
  for (const c of [...people, ...fromThreads]) {
    const em = c.email.toLowerCase();
    if (seen.has(em)) continue;
    seen.add(em);
    out.push(c);
    if (out.length >= max) break;
  }
  return out;
}

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const params = new URL(request.url).searchParams;
  const q = params.get("q")?.trim() ?? "";
  // The folder operator the search box was prefilled with (in:sent, …). It narrows
  // the thread hits only — contacts are matched on what was typed — and only a
  // known operator is accepted, since it is spliced into the Gmail query.
  const scopeRaw = params.get("scope")?.trim() ?? "";
  const scope = SUGGEST_SCOPE_RE.test(scopeRaw) ? scopeRaw : "";
  if (q.length < 1) {
    return NextResponse.json({ contacts: [], threads: [] });
  }

  try {
    const [people, threads] = await Promise.all([
      searchContactsByQuery(auth.accessToken, q),
      listThreadSearchSuggestions(auth.accessToken, scope ? `${scope} ${q}` : q, 5, {
        mailboxKey: auth.mailboxOwnerId,
      }),
    ]);

    const fromThreads = suggestEmailsFromThreads(threads, q);
    const contacts = mergeContacts(people, fromThreads, 6);
    const completionEmail = pickEmailCompletion(contacts, q);

    return NextResponse.json(
      { contacts, threads, completionEmail },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Suggest failed";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
