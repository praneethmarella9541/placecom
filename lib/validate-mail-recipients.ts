import { isCompleteEmailAddress } from "@/lib/email-recipients";

export type RecipientFieldName = "To" | "Cc" | "Bcc";

export type InvalidRecipient = {
  field: RecipientFieldName;
  address: string;
  empty?: boolean;
};

function recipientTokens(value: string): string[] {
  return value
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
}

function validateField(
  value: string,
  field: RecipientFieldName,
  required: boolean
): InvalidRecipient | null {
  const tokens = recipientTokens(value);
  if (tokens.length === 0) {
    if (required) return { field, address: "", empty: true };
    return null;
  }
  for (const token of tokens) {
    if (!isCompleteEmailAddress(token)) {
      return { field, address: token };
    }
  }
  return null;
}

/** First invalid address in To / Cc / Bcc (Gmail-style pre-send check). */
export function findInvalidRecipient(fields: {
  to: string;
  cc?: string;
  bcc?: string;
}): InvalidRecipient | null {
  return (
    validateField(fields.to, "To", true) ??
    validateField(fields.cc ?? "", "Cc", false) ??
    validateField(fields.bcc ?? "", "Bcc", false)
  );
}

export function formatRecipientError(invalid: InvalidRecipient): string {
  if (invalid.empty) {
    return "Please specify at least one recipient.";
  }
  return `The address "${invalid.address}" in the "${invalid.field}" field was not recognized. Please make sure that all addresses are properly formed.`;
}
