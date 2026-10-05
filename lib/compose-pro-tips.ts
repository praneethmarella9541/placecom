/**
 * Rotating hints shown as the compose body placeholder when the editor is
 * empty. Each time the dialog opens, pickRandomComposeProTip() returns a
 * different one so writers slowly discover templates, merge variables, mass
 * sending and paste shortcuts without a tour.
 *
 * Keep each tip to one short sentence — this renders as a single-line
 * placeholder, not a tour step.
 */
export const COMPOSE_PRO_TIPS: readonly string[] = [
  "Pro tip: Click Templates below to drop in a saved mail template.",
  "Pro tip: Type { in the subject or body to pull in a merge variable like {name}.",
  "Pro tip: Switch on mass sending to send a personalised copy to each recipient.",
  "Pro tip: Ctrl+V keeps the source formatting, Ctrl+Shift+V pastes as plain text.",
  "Pro tip: In mass sending, hit Review to preview the email for each recipient before you send.",
  "Pro tip: Under CSV / Excel in mass sending, you can also attach an existing Google Sheet as the source.",
] as const;

/** Picks a tip at random. Returns the fallback when the list is empty. */
export function pickRandomComposeProTip(fallback = "Compose email"): string {
  if (COMPOSE_PRO_TIPS.length === 0) return fallback;
  const i = Math.floor(Math.random() * COMPOSE_PRO_TIPS.length);
  return COMPOSE_PRO_TIPS[i];
}
