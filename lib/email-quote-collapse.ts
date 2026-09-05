/**
 * Collapses the quoted-history portion of a message body behind a Gmail-style
 * "···" toggle, closed by default.
 *
 * Without this, every message in a thread renders its *entire* raw body —
 * which, for any reply, includes a full copy of everything before it (Gmail
 * and most other clients embed the whole prior message inside each reply).
 * Since the thread view already renders each earlier message as its own
 * bubble, an un-collapsed reply duplicates that same content a second time
 * inside itself — and a third, fourth time down a longer thread. That
 * compounding duplication is what actually makes a rendered thread look
 * "messed up" next to Gmail, not any single styling detail.
 */

/**
 * HTML bodies: Gmail wraps quoted history in a trailing
 * `<div class="gmail_quote">…</div>` (or the newer `gmail_quote_container`
 * variant); Apple Mail and several other clients use `<blockquote type="cite">`.
 * Both are reliably the *last* thing in the fragment — Gmail never puts
 * meaningful content after its own quote block — so once the marker is found,
 * everything to the end of the fragment is quoted content. That sidesteps
 * needing a real balanced-tag HTML parser just to find where the block closes.
 */
const HTML_QUOTE_MARKERS: RegExp[] = [
  /<div[^>]+class="[^"]*\bgmail_quote\b[^"]*"[^>]*>/i,
  /<blockquote[^>]+type=["']cite["'][^>]*>/i,
];

function visibleTextLength(html: string): number {
  return html.replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").trim().length;
}

export function collapseQuotedHtml(html: string): string {
  for (const marker of HTML_QUOTE_MARKERS) {
    const match = marker.exec(html);
    if (!match || match.index === undefined) continue;

    const before = html.slice(0, match.index);
    const quoted = html.slice(match.index);
    // A pure forward (no new text of its own) has nothing to show if the
    // whole thing collapses — leave it expanded rather than rendering what
    // looks like an empty message.
    if (visibleTextLength(before) < 2) return html;

    return `${before}<details class="__quote-toggle"><summary aria-label="Show quoted text">⋯</summary>${quoted}</details>`;
  }
  return html;
}

/**
 * Plain-text bodies: the quoted tail starts at a "> " prefixed line, an
 * "On <date>, <name> wrote:" attribution line, or an "-----Original
 * Message-----" divider — the same set of markers lib/crm-evidence.ts strips
 * outright for the classifier prompt. Here the goal is different: keep the
 * text, just split it so the caller can render it behind a toggle instead of
 * discarding it.
 */
export function splitPlainTextQuote(text: string): { main: string; quoted: string | null } {
  const lines = text.split(/\r?\n/);
  let cutAt = -1;

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i]!.trim();
    if (t.startsWith(">")) {
      cutAt = i;
      break;
    }
    if (/^On .{6,80}\bwrote:\s*$/i.test(t)) {
      cutAt = i;
      break;
    }
    if (/^-{2,}\s*Original Message\s*-{2,}$/i.test(t)) {
      cutAt = i;
      break;
    }
  }

  if (cutAt < 0) return { main: text, quoted: null };

  const main = lines.slice(0, cutAt).join("\n").trimEnd();
  const quoted = lines.slice(cutAt).join("\n");
  // Same reasoning as the HTML case — nothing to collapse behind if there's
  // no new text in front of it.
  if (main.trim().length < 2) return { main: text, quoted: null };

  return { main, quoted };
}
