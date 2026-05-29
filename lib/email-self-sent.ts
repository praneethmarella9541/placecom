import { extractAllEmailsFromText } from "@/lib/email-recipients";
import { extractEmailAddress } from "@/lib/email-parse";

/** True when the user sent the message only to themselves (no other recipients). */
export function isSelfSentEmail(
  from: string,
  to: string,
  cc: string,
  myEmail: string,
): boolean {
  const me = myEmail.trim().toLowerCase();
  if (!me) return false;
  if (extractEmailAddress(from).toLowerCase() !== me) return false;
  const recipients = [
    ...extractAllEmailsFromText(to),
    ...extractAllEmailsFromText(cc),
  ].map((e) => e.toLowerCase());
  if (recipients.length === 0) return true;
  return recipients.every((e) => e === me);
}
