import { NextResponse } from "next/server";
import { withRecord } from "@/lib/data-model/route-helpers";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listThreadsPage } from "@/lib/gmail-inbox";
import { gmailAddressQuery, gmailDomainQuery } from "@/lib/gmail-address-query";

export const runtime = "nodejs";

/**
 * GET /api/data/records/[id]/emails
 * Mail with this person (their email addresses) or company (their domains), read live from the
 * mailbox the viewer is working in. Nothing is stored, so a teammate sees exactly what their own
 * mailbox access shows: your individual mailbox stays yours, and the common mailbox follows the
 * access an admin gave you. Draft mail is excluded.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await withRecord(request, (await props.params).id, "read");
  if ("response" in found) return found.response;
  const { record, object } = found;

  const list = (slug: string) => {
    const v = record.values[slug];
    return (Array.isArray(v) ? v : v ? [v] : []).filter((x): x is string => typeof x === "string").slice(0, 5);
  };
  let query: string | null = null;
  if (object.slug === "people") {
    const emails = list("email_addresses");
    if (emails.length) query = emails.length === 1 ? gmailAddressQuery(emails[0]) : `(${emails.map((e) => gmailAddressQuery(e).replace(/ -in:drafts$/, "")).join(" OR ")}) -in:drafts`;
  } else if (object.slug === "companies") {
    const domains = list("domains");
    if (domains.length) query = domains.length === 1 ? gmailDomainQuery(domains[0]) : `(${domains.map((d) => gmailDomainQuery(d).replace(/ -in:drafts$/, "")).join(" OR ")}) -in:drafts`;
  }
  if (!query) return NextResponse.json({ items: [], reason: "no_address" });

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message, items: [] }, { status: auth.status });

  try {
    const page = await listThreadsPage(auth.accessToken, { folder: "allmail", maxResults: 30, searchQuery: query, mailboxKey: auth.mailboxKey });
    return NextResponse.json({
      items: page.threads.map((t) => ({
        id: t.id,
        subject: t.subject || "(no subject)",
        snippet: t.snippet,
        at: t.date,
        hasAttachments: t.hasAttachments && !t.hasCalendarInvite,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Couldn't read mail right now. Try again in a moment.", items: [] }, { status: 502 });
  }
}
