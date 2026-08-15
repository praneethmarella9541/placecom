/**
 * Fast, cheap first-pass filter for obviously-automated senders (no-reply,
 * digests, bank/transaction statements, mailer daemons) — used both at sync
 * time (lib/people-mailbox-sync.ts, so junk never gets written) and at read
 * time (the synced-contacts API routes, so already-synced junk stops
 * showing immediately without waiting for a resync).
 *
 * This is a coarse local-part pattern match, not a domain denylist — it
 * generalizes across companies without needing to know which ones send
 * notification mail. It won't catch every automated sender (e.g. a platform
 * that mints a unique address per notification) — see has_outbound_contact
 * on synced_contacts for the stronger, direction-based signal that does.
 */
const NOISE_LOCAL_PART =
  /^(no-?reply|do-?not-?reply|donotreply|notifications?|mailer-?daemon|bounces?|postmaster|automated|alerts?|digest|newsletters?|billing|statements?|txn|transactions?)([.\-_].*)?$/i;

export function isLikelyAutomatedAddress(email: string): boolean {
  const local = email.split("@")[0]?.toLowerCase().trim() ?? "";
  return NOISE_LOCAL_PART.test(local);
}
