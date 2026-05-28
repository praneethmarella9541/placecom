/** Gmail-style avatar background palette (stable per contact). */
const GMAIL_AVATAR_COLORS = [
  "#1a73e8",
  "#d93025",
  "#188038",
  "#e37400",
  "#9334e6",
  "#c5221f",
  "#137333",
  "#185abc",
  "#a142f4",
  "#0d652d",
  "#b06000",
  "#5e35b1",
] as const;

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

/** Pick a Gmail-like avatar color from an email or display name. */
export function gmailAvatarColor(seed: string): string {
  const key = seed.trim().toLowerCase() || "?";
  return GMAIL_AVATAR_COLORS[hashString(key) % GMAIL_AVATAR_COLORS.length];
}

/** First letter/digit of a display name — skips quotes and punctuation. */
export function gmailAvatarInitial(name: string): string {
  for (let i = 0; i < name.length; i++) {
    const ch = name.charAt(i);
    if (
      (ch >= "a" && ch <= "z") ||
      (ch >= "A" && ch <= "Z") ||
      (ch >= "0" && ch <= "9")
    ) {
      return ch.toUpperCase();
    }
  }
  const trimmed = name.trim();
  return (trimmed.charAt(0) || "?").toUpperCase();
}
