import { extractEmailAddress } from "@/lib/email-parse";

/** The name part of a From header, or the address's local part — never a stray "<". */
function displayNameOf(from: string): string {
  const m = from.match(/^"?([^"<]+?)"?\s*</);
  if (m && m[1].trim()) return m[1].trim();
  const addr = extractEmailAddress(from).replace(/[<>]/g, "");
  const at = addr.indexOf("@");
  return at > 0 ? addr.slice(0, at) : addr || "Unknown";
}

/** Titles that precede a name ("Dr. M. Mohamed Mustafa"); never the part Gmail shows. */
const HONORIFIC_RE = /^(dr|mr|mrs|ms|miss|mx|prof|professor|sir|shri|sri|smt|shrimati|er|ar|capt|col|maj|rev|fr)\.?$/i;
/** A bare initial or dotted initials: "M", "M.", "M.S.". */
const INITIALS_RE = /^(?:[a-z]\.?)+$/i;

/**
 * The name Gmail shows for someone else: their first name, skipping titles and
 * initials ("Dr. M. Mohamed Mustafa" → "Mohamed") and reading "Last, First" the
 * right way round. A name with nothing left after that (or a single token like
 * "Dr.S.Ramesh") is shown whole.
 */
export function shortNameOf(full: string): string {
  let name = full.trim();
  const comma = name.split(",");
  if (comma.length === 2 && comma[1].trim()) name = comma[1].trim(); // "Mustafa, Mohamed"
  const tokens = name.split(/\s+/).filter(Boolean);
  const first = tokens.find((t) => !HONORIFIC_RE.test(t) && !(t.length <= 4 && INITIALS_RE.test(t) && tokens.length > 1));
  return first ?? tokens[0] ?? full;
}

/**
 * How Gmail labels a conversation row: everyone who wrote in it ("me, raghu"),
 * oldest first, with the mailbox itself as "me" — not just whoever wrote last.
 * Other people get their first name, unless two share one. Long lists fold to
 * "first .. second-last, last".
 *
 * `participants` is each distinct sender's From header (from the server); a row
 * without it falls back to its last sender. `avatarFrom` is the From to draw the
 * avatar for: the most recent person who isn't you, since that's who the
 * conversation is with.
 */
export function threadParticipants(
  lastFrom: string,
  participants: string[] | undefined,
  myEmail: string
): { label: string; avatarFrom: string; avatarName: string } {
  const froms = participants && participants.length > 0 ? participants : [lastFrom];
  const me = myEmail.trim().toLowerCase();
  const entries = froms.map((from) => ({
    from,
    isMe: Boolean(me) && extractEmailAddress(from).trim().toLowerCase() === me,
    full: displayNameOf(from),
  }));

  const firstNames = entries.map((e) => (e.isMe ? "me" : shortNameOf(e.full)));
  const counts = new Map<string, number>();
  for (const n of firstNames) counts.set(n.toLowerCase(), (counts.get(n.toLowerCase()) ?? 0) + 1);
  const names = entries.map((e, i) =>
    e.isMe ? "me" : (counts.get(firstNames[i].toLowerCase()) ?? 0) > 1 ? e.full : firstNames[i]
  );

  const label =
    names.length > 3
      ? `${names[0]} .. ${names[names.length - 2]}, ${names[names.length - 1]}`
      : names.join(", ");
  const others = entries.filter((e) => !e.isMe);
  const avatarEntry = others.length ? others[others.length - 1] : entries[entries.length - 1];
  return { label, avatarFrom: avatarEntry.from, avatarName: avatarEntry.full };
}
