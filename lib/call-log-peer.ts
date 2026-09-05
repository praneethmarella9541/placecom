import "server-only";

import { normalizePhone, phoneMatches } from "@/lib/phone";
import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";

export type CallDirection = "incoming" | "outbound";

export type CallLogPeerRow = {
  to_number: string | null;
  from_number: string | null;
  agent_number?: string | null;
};

/**
 * Derives call direction + the "other party" (peer) number for a call_logs row.
 * Extracted from app/api/calls/route.ts so the per-contact timeline
 * (app/api/directory-contacts/[id]/timeline/route.ts) reuses the same logic instead
 * of duplicating it.
 *
 * Incoming: from_number = external caller, to_number = ours.
 * Outbound: from_number = ours, to_number = destination.
 */
export function deriveCallDirection(
  row: CallLogPeerRow,
  ourNumbers: string[]
): { direction: CallDirection; peerNumber: string | null } {
  const fromIsOurs = ourNumbers.some((v) => phoneMatches(v, row.from_number ?? ""));
  const toIsOurs = ourNumbers.some((v) => phoneMatches(v, row.to_number ?? ""));

  let direction: CallDirection = "outbound";
  if (fromIsOurs) direction = "outbound";
  else if (toIsOurs) direction = "incoming";
  else if (row.from_number) direction = "incoming"; // unknown from-leg: assume it's the external caller

  const peerNumber = direction === "incoming" ? row.from_number : row.to_number;
  return { direction, peerNumber };
}

/**
 * Every virtual/agent number that could plausibly be "ours" for a set of call rows —
 * combines the global configured Exotel numbers with each row's own `agent_number` (plus
 * any extra numbers, e.g. the viewing user's personal mobile). Now that call_logs is
 * shared org-wide (0041_leads_call_logs_shared_rls.sql), direction must resolve correctly
 * regardless of which staff member's call a given row belongs to — agent_number on the
 * row itself is what makes that possible without needing the viewer's own telephony profile.
 */
export function ourNumbersForRows(rows: CallLogPeerRow[], extra: string[] = []): string[] {
  const set = new Set<string>();
  for (const n of listConfiguredExotelNumbers()) set.add(n);
  for (const n of extra) if (n) set.add(normalizePhone(n));
  for (const r of rows) if (r.agent_number) set.add(normalizePhone(r.agent_number));
  return Array.from(set);
}
