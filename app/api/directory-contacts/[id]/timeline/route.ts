import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listThreadsPage } from "@/lib/gmail-inbox";
import { gmailAddressQuery } from "@/lib/gmail-address-query";
import { searchPrimaryCalendarEvents } from "@/lib/google-calendar";

export const runtime = "nodejs";

export type TimelineItem = {
  id: string;
  type: "email" | "meeting";
  summary: string;
  detail?: string;
  at: string;
  threadId?: string;
  /** Email items only — whether the thread has a file attachment (not counting a calendar invite). */
  hasAttachments?: boolean;
};

/**
 * GET /api/directory-contacts/[id]/timeline?source=email|meeting
 * One source per call — mirrors CompanyDetailPanel's lazy per-tab load pattern
 * rather than one big fan-out request. Frontend merges both for "All Interaction".
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const source = new URL(request.url).searchParams.get("source");
  if (!source || !["email", "meeting"].includes(source)) {
    return NextResponse.json({ error: "source must be email|meeting" }, { status: 400 });
  }

  const { data: contact, error: contactError } = await supabase
    .from("directory_contacts")
    .select("email, phone")
    .eq("id", params.id)
    .maybeSingle();
  if (contactError) return NextResponse.json({ error: contactError.message }, { status: 500 });
  if (!contact) return NextResponse.json({ error: "Contact not found" }, { status: 404 });

  try {
    if (source === "email") {
      if (!contact.email) return NextResponse.json({ items: [] });
      const auth = await requireGmailAccessToken(request);
      if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

      const page = await listThreadsPage(auth.accessToken, {
        folder: "allmail",
        maxResults: 50,
        searchQuery: gmailAddressQuery(contact.email),
        mailboxKey: auth.mailboxOwnerId,
      });
      const items: TimelineItem[] = page.threads.map((t) => ({
        id: t.id,
        type: "email",
        summary: t.subject || "(no subject)",
        detail: t.snippet,
        at: t.date,
        threadId: t.id,
        // A calendar invite is technically a file attachment (.ics) too, but
        // gets its own icon elsewhere — don't also flag it as "has attachments".
        hasAttachments: t.hasAttachments && !t.hasCalendarInvite,
      }));
      return NextResponse.json({ items });
    }

    // source === "meeting"
    if (!contact.email) return NextResponse.json({ items: [] });
    const auth = await requireGmailAccessToken(request);
    if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

    const events = await searchPrimaryCalendarEvents(auth.accessToken, contact.email, { maxResults: 100 });
    const matching = events.filter((ev) =>
      ev.attendees?.some((a) => a.email?.toLowerCase() === contact.email!.toLowerCase())
    );
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
