import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listThreadsPage } from "@/lib/gmail-inbox";
import { gmailAddressQuery } from "@/lib/gmail-address-query";
import { searchPrimaryCalendarEvents } from "@/lib/google-calendar";
import { canonicalWhatsAppPeer, peerKeysForQuery } from "@/lib/whatsapp-peer";
import { resolveDisplayNames } from "@/lib/team-scope";

export const runtime = "nodejs";

export type TimelineItem = {
  id: string;
  type: "email" | "meeting" | "whatsapp";
  summary: string;
  detail?: string;
  at: string;
  threadId?: string;
  /** Email items only — whether the thread has a file attachment (not counting a calendar invite). */
  hasAttachments?: boolean;
  /**
   * WhatsApp items only — which team member this row belongs to. Only set when
   * an admin is viewing combined team activity (more than one teammate's rows
   * in the result, or someone else's alone); omitted when every row is just the
   * viewer's own, so nothing changes for staff.
   */
  by?: string;
};

/** Attaches `by` to items whose row belongs to someone other than the viewer, or when the
 *  result mixes more than one team member's rows — never for a plain "just my own" list. */
async function attributeToOwners<T extends { user_id: string | null }>(
  rows: T[],
  viewerId: string
): Promise<Map<string, string>> {
  const distinctIds = new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]);
  const showAttribution =
    distinctIds.size > 1 || (distinctIds.size === 1 && !distinctIds.has(viewerId));
  if (!showAttribution) return new Map();
  const idList = Array.from(distinctIds);
  const names = await resolveDisplayNames(idList);
  const byId = new Map<string, string>();
  for (const id of idList) {
    byId.set(id, id === viewerId ? "You" : names.get(id) ?? "Teammate");
  }
  return byId;
}

/**
 * GET /api/directory-contacts/[id]/timeline?source=email|meeting|whatsapp
 * One source per call — mirrors CompanyDetailPanel's lazy per-tab load pattern
 * rather than one big fan-out request. Frontend merges them for "All Interaction".
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const source = new URL(request.url).searchParams.get("source");
  if (!source || !["email", "meeting", "whatsapp"].includes(source)) {
    return NextResponse.json({ error: "source must be email|meeting|whatsapp" }, { status: 400 });
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

    if (source === "meeting") {
      if (!contact.email) return NextResponse.json({ items: [] });
      const auth = await requireGmailAccessToken(request);
      if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

      const events = await searchPrimaryCalendarEvents(auth.accessToken, contact.email, {
        maxResults: 100,
      });
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
    }

    // source === "whatsapp" — no business_e164/own-line filter: RLS (migration
    // 0048) already scopes rows to "my own" for staff or "my whole team's" for
    // an admin, so a staff member sees only their own thread with this contact
    // while their admin sees every team member's.
    if (!contact.phone) return NextResponse.json({ items: [] });

    const peerNorm = canonicalWhatsAppPeer(contact.phone);
    const peerKeys = peerKeysForQuery(peerNorm);
    const { data: waRows, error: waError } = await supabase
      .from("whatsapp_messages")
      .select("id, user_id, direction, body, content_type, created_at")
      .in("peer_e164", peerKeys)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (waError) return NextResponse.json({ error: waError.message }, { status: 500 });

    const byId = await attributeToOwners(waRows ?? [], user.id);
    const items: TimelineItem[] = (waRows ?? []).map((r) => ({
      id: r.id as string,
      type: "whatsapp" as const,
      summary: (r.body as string | null) || `[${(r.content_type as string | null) || "media"}]`,
      detail: r.direction === "inbound" ? "Received" : "Sent",
      at: r.created_at as string,
      by: r.user_id ? byId.get(r.user_id as string) : undefined,
    }));
    return NextResponse.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load timeline";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
