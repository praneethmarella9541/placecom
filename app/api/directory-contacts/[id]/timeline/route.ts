import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listThreadsPage } from "@/lib/gmail-inbox";
import { gmailAddressQuery } from "@/lib/gmail-address-query";
import { searchPrimaryCalendarEvents } from "@/lib/google-calendar";
import { deriveCallDirection, ourNumbersForRows } from "@/lib/call-log-peer";
import { phoneLookupVariants, normalizePhone } from "@/lib/phone";
import { canonicalWhatsAppPeer, peerKeysForQuery } from "@/lib/whatsapp-peer";
import { getUserWhatsAppLine } from "@/lib/whatsapp-telephony";

export const runtime = "nodejs";

export type TimelineItem = {
  id: string;
  type: "email" | "call" | "meeting" | "whatsapp";
  summary: string;
  detail?: string;
  at: string;
  threadId?: string;
  /** Email items only — whether the thread has a file attachment (not counting a calendar invite). */
  hasAttachments?: boolean;
};

/**
 * GET /api/directory-contacts/[id]/timeline?source=email|call|meeting|whatsapp
 * One source per call — mirrors CompanyDetailPanel's lazy per-tab load pattern
 * rather than one big fan-out request. Frontend merges all four for "All Interaction".
 */
export async function GET(request: Request, { params }: { params: { id: string } }) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const source = new URL(request.url).searchParams.get("source");
  if (!source || !["email", "call", "meeting", "whatsapp"].includes(source)) {
    return NextResponse.json({ error: "source must be email|call|meeting|whatsapp" }, { status: 400 });
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
    }

    if (source === "call") {
      if (!contact.phone) return NextResponse.json({ items: [] });
      const variants = phoneLookupVariants(normalizePhone(contact.phone));
      if (variants.length === 0) return NextResponse.json({ items: [] });

      const orFilter = variants
        .flatMap((v) => [`to_number.eq.${v}`, `from_number.eq.${v}`])
        .join(",");
      const { data: rows, error } = await supabase
        .from("call_logs")
        .select("id, to_number, from_number, agent_number, status, duration_seconds, notes, started_at, created_at")
        .or(orFilter)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

      const ourNumbers = ourNumbersForRows(rows ?? []);
      const items: TimelineItem[] = (rows ?? []).map((r) => {
        const { direction } = deriveCallDirection(r, ourNumbers);
        const durationLabel = r.duration_seconds ? `${r.duration_seconds}s` : r.status;
        return {
          id: r.id,
          type: "call",
          summary: `${direction === "incoming" ? "Incoming" : "Outbound"} call — ${durationLabel}`,
          detail: r.notes ?? undefined,
          at: r.started_at || r.created_at,
        };
      });
      return NextResponse.json({ items });
    }

    // source === "whatsapp"
    if (!contact.phone) return NextResponse.json({ items: [] });
    const lineResult = await getUserWhatsAppLine(supabase, user.id);
    if (!lineResult.ok) return NextResponse.json({ items: [] });

    const peerNorm = canonicalWhatsAppPeer(contact.phone);
    const peerKeys = peerKeysForQuery(peerNorm);
    const { data: rows, error } = await supabase
      .from("whatsapp_messages")
      .select("id, direction, body, content_type, created_at")
      .in("peer_e164", peerKeys)
      .eq("business_e164", lineResult.data.line)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const items: TimelineItem[] = (rows ?? []).map((r) => ({
      id: r.id,
      type: "whatsapp",
      summary: r.body || `[${r.content_type || "media"}]`,
      detail: r.direction === "inbound" ? "Received" : "Sent",
      at: r.created_at,
    }));
    return NextResponse.json({ items });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load timeline";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
