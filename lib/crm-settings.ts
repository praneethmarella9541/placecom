export type CrmSettings = {
  /** YYYY-MM-DD. Only mail/WhatsApp on or after this date is fed to the classifier. */
  season_start_date: string | null;
  model: string;
  confidence_threshold: number;
};

/**
 * Models offered for lead classification, cheapest first. Prices are per
 * million tokens and are shown in the UI so the cost of switching is visible
 * at the point of choosing — the authoritative figures used for billing live
 * in lib/openai-pricing.ts, which reads the same env overrides.
 *
 * Verify against https://platform.openai.com/docs/pricing before relying on
 * these for anything but a rough estimate.
 */
export const CRM_MODELS = [
  {
    id: "gpt-5-nano",
    label: "GPT-5 nano",
    hint: "Cheapest — fine for short mail/chat snippets",
    inputPerMTok: 0.05,
    outputPerMTok: 0.4,
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 mini",
    hint: "Better reasoning on ambiguous threads",
    inputPerMTok: 0.25,
    outputPerMTok: 2,
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    hint: "Older, well-understood fallback",
    inputPerMTok: 0.15,
    outputPerMTok: 0.6,
  },
] as const;

export const DEFAULT_CRM_SETTINGS: CrmSettings = {
  season_start_date: null,
  model: "gpt-5-nano",
  confidence_threshold: 0.6,
};

export function crmModelLabel(id: string): string {
  return CRM_MODELS.find((m) => m.id === id)?.label ?? id;
}
