export type EmailConnectionStrength = "Good" | "Weak" | "Very weak" | "No communication";

/**
 * Shared recency + 90-day-volume bucketing rule for email engagement, used both by
 * the single-lead live Gmail query (lib/lead-email-connection.ts) and the bulk
 * mailbox scan (lib/company-mailbox-sync.ts), which already has the dates in hand.
 */
export function bucketEmailConnection(params: {
  lastInteractionAt: string | null;
  recentCount90d: number;
}): EmailConnectionStrength {
  if (!params.lastInteractionAt) return "No communication";

  const daysSince =
    (Date.now() - new Date(params.lastInteractionAt).getTime()) / (24 * 60 * 60 * 1000);

  if (daysSince <= 7 && params.recentCount90d >= 3) return "Good";
  if (daysSince <= 30) return "Weak";
  return "Very weak";
}
