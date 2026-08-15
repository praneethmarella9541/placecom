import type { EmailConnectionStrength } from "@/lib/email-connection-strength";

export const CONNECTION_STRENGTH_DOT: Record<EmailConnectionStrength, string> = {
  Good: "bg-[var(--color-success)]",
  Weak: "bg-[var(--color-warning)]",
  "Very weak": "bg-red-500",
  "No communication": "bg-[var(--color-text-faint)]",
};
