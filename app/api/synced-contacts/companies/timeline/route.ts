import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listThreadsPage } from "@/lib/gmail-inbox";
import { gmailDomainQuery } from "@/lib/gmail-address-query";
import { classifyEmail, type EmailCategory } from "@/lib/email-category";

export const runtime = "nodejs";

export type CompanyEmailItem = {
  id: string;
  subject: string;
  snippet: string;
  from: string;
  date: string;
  category: EmailCategory | null;
  hasAttachments: boolean;
};

/**
 * GET /api/synced-contacts/companies/timeline?domain=...
 *
 * Company-wide email feed — every thread to/from *anyone* @domain, not just
 * one synced contact (see /api/synced-contacts/timeline for the per-person
 * version). `category` is a best-effort subject/snippet keyword guess (see
 * lib/email-category.ts) — not real Gmail labels; there's no engine here
 * that reads intent the way Attio's classifier does.
 */
export async function GET(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const domain = new URL(request.url).searchParams.get("domain")?.trim().toLowerCase();
  if (!domain) return NextResponse.json({ error: "domain is required" }, { status: 400 });

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    const page = await listThreadsPage(auth.accessToken, {
      folder: "allmail",
      maxResults: 50,
      searchQuery: gmailDomainQuery(domain),
      mailboxKey: auth.mailboxOwnerId,
    });
    const items: CompanyEmailItem[] = page.threads.map((t) => ({
      id: t.id,
      subject: t.subject || "(no subject)",
      snippet: t.snippet,
      from: t.from,
      date: t.date,
      category: classifyEmail({ subject: t.subject || "", snippet: t.snippet || "", from: t.from }),
      hasAttachments: Boolean(t.hasAttachments && !t.hasCalendarInvite),
    }));
    return NextResponse.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load company emails";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
