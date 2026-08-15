import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { fetchAllRows } from "@/lib/supabase-fetch-all";
import type { EmailConnectionStrength } from "@/lib/email-connection-strength";
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
  synced_at: string | null;
};

/** GET /api/synced-contacts — people auto-derived from the caller's admin mailbox (see lib/people-mailbox-sync.ts) */
export async function GET(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await fetchAllRows<SyncedContactRow>((from, to) =>
    supabase
      .from("synced_contacts")
      .select("*")
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
          .select("*")
          .order("last_interaction_at", { ascending: false, nullsFirst: false })
          .order("id", { ascending: true })
          .range(from, to)
      );
      if (fallback.error) return NextResponse.json({ error: fallback.error }, { status: 500 });
      const contacts = fallback.data.filter((c) => !isLikelyAutomatedAddress(c.email));
      return NextResponse.json({ contacts });
    }
    return NextResponse.json({ error }, { status: 500 });
  }

  const contacts = data.filter((c) => !isLikelyAutomatedAddress(c.email));
  return NextResponse.json({ contacts });
}
