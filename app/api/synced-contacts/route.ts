import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import { bucketEmailConnection, type EmailConnectionStrength } from "@/lib/email-connection-strength";
import { getConnectionStrengthSettings } from "@/lib/connection-strength-settings";
import { isLikelyAutomatedAddress } from "@/lib/mail-noise-filter";

export const runtime = "nodejs";

export type SyncedContactRow = {
  id: string;
  email: string;
  display_name: string | null;
  domain: string | null;
  company_name: string | null;
  last_interaction_at: string | null;
  connection_strength: EmailConnectionStrength | null;
  message_count_90d: number;
  message_count_total: number;
  has_outbound_contact?: boolean;
  has_direct_contact?: boolean;
  recent_message_dates?: number[] | null;
  synced_at: string | null;
};

/**
 * Only what the client renders. `select("*")` used to be handed straight back,
 * which shipped recent_message_dates — up to 300 epoch-ms integers per row
 * (migration 0053) — to a browser that never reads it. At the row counts this
 * table reaches (2,484 when fetchAllRows was added) that is several MB of JSON
 * per request, and it dominated the Contacts page's load time.
 *
 * The three excluded columns are inputs to bucketEmailConnection, not output:
 * they're still selected below and still drive connection_strength, they just
 * stop at the server.
 */
const CLIENT_COLUMNS = [
  "id",
  "email",
  "display_name",
  "domain",
  "company_name",
  "last_interaction_at",
  "connection_strength",
  "message_count_90d",
  "message_count_total",
  "synced_at",
] as const;

/**
 * Columns fetched from Postgres — the client set plus the bucketing inputs.
 * Spelled out as a literal rather than built from CLIENT_COLUMNS: supabase-js
 * infers the row type from the select string, and a computed one degrades the
 * result to an untyped error shape.
 */
const SELECT_COLUMNS =
  "id, email, display_name, domain, company_name, last_interaction_at, connection_strength, message_count_90d, message_count_total, synced_at, has_outbound_contact, has_direct_contact, recent_message_dates";

/** Same, minus has_outbound_contact — for pre-0042 tables (see the retry below). */
const SELECT_COLUMNS_LEGACY =
  "id, email, display_name, domain, company_name, last_interaction_at, connection_strength, message_count_90d, message_count_total, synced_at, recent_message_dates";

type ClientContact = Pick<SyncedContactRow, (typeof CLIENT_COLUMNS)[number]>;

function toClientRows(rows: SyncedContactRow[]): ClientContact[] {
  return rows.map((row) => {
    const out = {} as Record<string, unknown>;
    for (const key of CLIENT_COLUMNS) out[key] = row[key];
    return out as ClientContact;
  });
}

/**
 * Recomputes connection_strength per row against the caller's own thresholds
 * instead of trusting the stored column, which lib/people-mailbox-sync.ts
 * only (re)writes using the default thresholds when a sync happens to touch
 * that contact — see lib/email-connection-strength.ts.
 */
function withLiveStrength<T extends SyncedContactRow>(
  rows: T[],
  settings: Awaited<ReturnType<typeof getConnectionStrengthSettings>>
): T[] {
  return rows.map((row) => ({
    ...row,
    connection_strength: bucketEmailConnection(
      {
        lastInteractionAt: row.last_interaction_at,
        messageDates: Array.isArray(row.recent_message_dates) ? row.recent_message_dates : [],
        recentCount90dFallback: row.message_count_90d,
        hasOutboundContact: Boolean(row.has_outbound_contact),
        // Column defaults true (migration 0051) — "not disproven yet", not "confirmed cc-only".
        hasDirectContact: row.has_direct_contact !== false,
      },
      settings
    ),
  }));
}

/** GET /api/synced-contacts — people auto-derived from the caller's admin mailbox (see lib/people-mailbox-sync.ts) */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const settings = await getConnectionStrengthSettings(supabase, user.id);

  const { data, error } = await fetchAllRows<SyncedContactRow>((from, to) =>
    supabase
      .from("synced_contacts")
      .select(SELECT_COLUMNS)
      // Real (two-way) contacts first, then most recently active — pushes
      // inbound-only automated senders that slipped past the noise filter
      // below (e.g. a platform minting a unique address per notification)
      // toward the bottom instead of the top. `id` is just a tiebreaker for
      // stable pagination (fetchAllRows) — has_outbound_contact/last_interaction_at
      // alone can tie across many rows.
      .order("has_outbound_contact", { ascending: false, nullsFirst: false })
      .order("last_interaction_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: true })
      .range(from, to)
  );

  if (error) {
    if (/relation.*synced_contacts.*does not exist/i.test(error)) {
      return NextResponse.json({ contacts: [] });
    }
    // has_outbound_contact may not exist yet on a pre-migration table — retry
    // without it rather than failing the whole request.
    if (/column.*has_outbound_contact.*does not exist/i.test(error)) {
      const fallback = await fetchAllRows<SyncedContactRow>((from, to) =>
        supabase
          .from("synced_contacts")
          .select(SELECT_COLUMNS_LEGACY)
          .order("last_interaction_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(from, to)
      );
      if (fallback.error) return NextResponse.json({ error: fallback.error }, { status: 500 });
      const contacts = withLiveStrength(fallback.data.filter((c) => !isLikelyAutomatedAddress(c.email)), settings);
      return NextResponse.json({ contacts: toClientRows(contacts) });
    }
    return NextResponse.json({ error }, { status: 500 });
  }

  const contacts = withLiveStrength(data.filter((c) => !isLikelyAutomatedAddress(c.email)), settings);
  return NextResponse.json({ contacts: toClientRows(contacts) });
}
