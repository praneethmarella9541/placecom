import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listThreadsPage } from "@/lib/gmail-inbox";
import { gmailAddressQuery } from "@/lib/gmail-address-query";
import { searchPrimaryCalendarEvents } from "@/lib/google-calendar";
import type { TimelineItem } from "@/app/api/directory-contacts/[id]/timeline/route";

export const runtime = "nodejs";

/**
 * GET /api/synced-contacts/timeline?email=...&source=email|meeting
 *
 * Same idea as /api/directory-contacts/[id]/timeline, but for a synced
 * contact — which is just an email address auto-derived from the mailbox
 * (see lib/people-mailbox-sync.ts), not a directory_contacts row. So this
 * takes the address directly instead of looking one up by id, and only
 * covers email/meetings — synced contacts don't carry a phone number, so
 * there's nothing to look up for Calls/WhatsApp.
 */
export async function GET(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const email = url.searchParams.get("email")?.trim().toLowerCase();
  const source = url.searchParams.get("source");
  if (!email) return NextResponse.json({ error: "email is required" }, { status: 400 });
  if (!source || !["email", "meeting"].includes(source)) {
    return NextResponse.json({ error: "source must be email|meeting" }, { status: 400 });
  }

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  try {
    if (source === "email") {
      const page = await listThreadsPage(auth.accessToken, {
        folder: "allmail",
        maxResults: 50,
        searchQuery: gmailAddressQuery(email),
      });
      const items: TimelineItem[] = page.threads.map((t) => ({
        id: t.id,
        type: "email",
        summary: t.subject || "(no subject)",
        detail: t.snippet,
        at: t.date,
        threadId: t.id,
        hasAttachments: t.hasAttachments && !t.hasCalendarInvite,
      }));
      return NextResponse.json({ items });
    }

    // source === "meeting"
    const events = await searchPrimaryCalendarEvents(auth.accessToken, email, { maxResults: 100 });
    const matching = events.filter((ev) => ev.attendees?.some((a) => a.email?.toLowerCase() === email));
    const items: TimelineItem[] = matching.map((ev) => ({
      id: ev.id,
      type: "meeting",
      summary: ev.summary || "(untitled event)",
      detail: ev.location,
      at: ev.start.dateTime || ev.start.date || new Date().toISOString(),
    }));
    return NextResponse.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load timeline";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
