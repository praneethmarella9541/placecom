export type EmailConnectionStrength = "Good" | "Weak" | "Very weak" | "No communication";

/** Per-user tunable thresholds — see user_connection_strength_settings (migrations 0050, 0052). */
export type ConnectionStrengthSettings = {
  goodRecencyDays: number;
  goodMinMessages: number;
  /** Volume window "goodMinMessages" is counted over — independently configurable, not fixed at 90. */
  goodWindowDays: number;
  requireOutboundForGood: boolean;
  weakRecencyDays: number;
  weakMinMessages: number;
  weakWindowDays: number;
  requireOutboundForWeak: boolean;
  /** A contact only ever Cc'd (never From/To — see has_direct_contact) counts as No communication, not Good/Weak/Very weak. */
  treatCcOnlyAsNoCommunication: boolean;
};

/** Matches the original hardcoded rule — used whenever a user has no settings row of their own. */
export const DEFAULT_CONNECTION_STRENGTH_SETTINGS: ConnectionStrengthSettings = {
  goodRecencyDays: 7,
  goodMinMessages: 3,
  goodWindowDays: 90,
  requireOutboundForGood: true,
  weakRecencyDays: 30,
  weakMinMessages: 1,
  weakWindowDays: 90,
  requireOutboundForWeak: true,
  treatCcOnlyAsNoCommunication: true,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** How many of `messageDates` (epoch-ms) fall within `windowDays` of now. */
function countWithinWindow(messageDates: number[], windowDays: number): number {
  const cutoff = Date.now() - windowDays * DAY_MS;
  return messageDates.filter((d) => d >= cutoff).length;
}

/**
 * Recency + volume bucketing rule for email engagement, evaluated live at
 * read time (app/api/synced-contacts/*) against each caller's own
 * ConnectionStrengthSettings — not stored, so a bucket reflects "as of right
 * now" rather than whatever it was the last time a sync happened to touch
 * that contact.
 *
 * messageDates is the raw per-message date list lib/people-mailbox-sync.ts
 * persists (capped to the most recent 300 — see migration 0053), which is
 * what makes goodWindowDays/weakWindowDays genuinely independent settings
 * rather than both being stuck at a single hardcoded 90-day rollup. Legacy
 * rows synced before that migration have no dates yet — recentCount90dFallback
 * (the old fixed rollup) is used for both tiers in that case, regardless of
 * their configured window, until a fresh sync populates real dates.
 *
 * Checked in this order:
 *  1. No last_interaction_at at all → No communication (never synced any
 *     message with them, period).
 *  2. treatCcOnlyAsNoCommunication and they were only ever Cc'd, never a
 *     direct From/To → also No communication — being cc'd on a thread isn't
 *     communication *with* them.
 *  3. Good, then Weak — each checked independently (so failing Good only on
 *     its outbound requirement still gets evaluated for Weak, rather than
 *     being force-capped).
 *  4. Otherwise, Very weak — the catch-all for "some real correspondence
 *     exists, just not enough to clear Weak's bar."
 */
export function bucketEmailConnection(
  params: {
    lastInteractionAt: string | null;
    /** Raw per-message epoch-ms dates, newest first — empty on rows not yet touched by a sync since migration 0053. */
    messageDates: number[];
    /** Old fixed 90-day rollup — fallback only, used when messageDates is empty. */
    recentCount90dFallback: number;
    hasOutboundContact: boolean;
    hasDirectContact: boolean;
  },
  settings: ConnectionStrengthSettings = DEFAULT_CONNECTION_STRENGTH_SETTINGS
): EmailConnectionStrength {
  if (!params.lastInteractionAt) return "No communication";
  if (settings.treatCcOnlyAsNoCommunication && !params.hasDirectContact) return "No communication";

  const daysSince =
    (Date.now() - new Date(params.lastInteractionAt).getTime()) / DAY_MS;

  const hasRealDates = params.messageDates.length > 0;
  const countInWindow = (windowDays: number) =>
    hasRealDates ? countWithinWindow(params.messageDates, windowDays) : params.recentCount90dFallback;

  const qualifiesGood =
    daysSince <= settings.goodRecencyDays &&
    countInWindow(settings.goodWindowDays) >= settings.goodMinMessages &&
    (!settings.requireOutboundForGood || params.hasOutboundContact);
  if (qualifiesGood) return "Good";

  const qualifiesWeak =
    daysSince <= settings.weakRecencyDays &&
    countInWindow(settings.weakWindowDays) >= settings.weakMinMessages &&
    (!settings.requireOutboundForWeak || params.hasOutboundContact);
  if (qualifiesWeak) return "Weak";

  return "Very weak";
}
