/**
 * Selectable models for the mail assistant.
 *
 * The UI shows these in a dropdown; the API validates the incoming `model`
 * against this allowlist and falls back to the default if it's unknown.
 * Keep ids aligned with what the rest of the app already uses (see
 * lib/openai-extract.ts and lib/openai-pricing.ts).
 */
export type MailAssistantModelId = "gpt-5" | "gpt-5-mini" | "gpt-4o" | "gpt-4o-mini";

export type MailAssistantModel = {
  id: MailAssistantModelId;
  /** Shown in the model picker. */
  label: string;
  /** One-liner to help the user choose. */
  hint: string;
  /** Whether the model can read inline/attachment images (vision). */
  vision: boolean;
};

export const MAIL_ASSISTANT_MODELS: readonly MailAssistantModel[] = [
  {
    id: "gpt-5",
    label: "GPT-5",
    hint: "Most capable — best for multi-step reasoning over many emails",
    vision: true,
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 mini",
    hint: "Faster and cheaper — great default for everyday questions",
    vision: true,
  },
  {
    id: "gpt-4o",
    label: "GPT-4o",
    hint: "Strong general model with vision",
    vision: true,
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    hint: "Cheapest — quick summaries and lookups",
    vision: true,
  },
] as const;

export const DEFAULT_MAIL_ASSISTANT_MODEL: MailAssistantModelId = "gpt-5-mini";

const VALID_IDS = new Set<string>(MAIL_ASSISTANT_MODELS.map((m) => m.id));

/** Returns a known model id, falling back to the default for anything unexpected. */
export function resolveModelId(input: unknown): MailAssistantModelId {
  if (typeof input === "string" && VALID_IDS.has(input)) {
    return input as MailAssistantModelId;
  }
  return DEFAULT_MAIL_ASSISTANT_MODEL;
}
