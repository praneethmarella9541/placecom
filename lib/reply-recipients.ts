import { extractEmailAddress } from "@/lib/email-parse";
import { extractAllEmailsFromText } from "@/lib/email-recipients";

/**
 * Who Reply / Reply All should address, for the message being replied to.
 *
 * Replying to a message someone else sent: To is that sender. Reply All CCs
 * everyone else on it (To + Cc), except the sender and the mailbox itself.
 *
 * Replying to a message the mailbox itself sent — the last message of a thread
 * you wrote and nobody has answered yet, or anything opened from Sent: the
 * "sender" is you, so addressing it would send the reply to yourself. Like Gmail,
 * address the people it was sent to instead: Reply goes to the original To;
 * Reply All keeps the original To and Cc.
 *
 * Addresses are compared case-insensitively. `myEmail` is the mailbox's Gmail
 * address (the shared mailbox for staff, not their own login).
 */
export function replyRecipients(
  last: { from: string; to: string; cc: string },
  mode: "reply" | "replyAll",
  myEmail: string
): { to: string; cc: string } {
  const me = myEmail.trim().toLowerCase();
  const isMe = (addr: string) => Boolean(me) && addr.toLowerCase() === me;
  const unique = (addrs: string[]) => {
    const seen = new Set<string>();
    return addrs.filter((a) => {
      const k = a.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  };

  const sender = extractEmailAddress(last.from);
  const toList = unique(extractAllEmailsFromText(last.to || ""));
  const ccList = unique(extractAllEmailsFromText(last.cc || ""));

  if (!isMe(sender)) {
    if (mode === "reply") return { to: sender, cc: "" };
    const exclude = new Set([sender.toLowerCase()]);
    const cc = unique([...toList, ...ccList]).filter((a) => !exclude.has(a.toLowerCase()) && !isMe(a));
    return { to: sender, cc: cc.join(", ") };
  }

  // Sent by the mailbox itself.
  const others = toList.filter((a) => !isMe(a));
  let to: string[];
  if (others.length > 0) to = others;
  else if (toList.length > 0) to = toList; // only sent to itself — replying to itself is right
  else to = ccList.filter((a) => !isMe(a)); // no To at all (Cc/Bcc-only send)

  if (mode === "reply") return { to: to.join(", "), cc: "" };
  const inTo = new Set(to.map((a) => a.toLowerCase()));
  const cc = ccList.filter((a) => !isMe(a) && !inTo.has(a.toLowerCase()));
  return { to: to.join(", "), cc: cc.join(", ") };
}
