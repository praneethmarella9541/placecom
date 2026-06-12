/** Escape text for safe HTML insertion. */
export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PLAIN_URL_RE = /\bhttps?:\/\/[^\s<>"'\u00a0]+/gi;

function trimTrailingPunctuation(url: string): { href: string; trailing: string } {
  const match = url.match(/([.,;:!?)]+)$/);
  if (!match) return { href: url, trailing: "" };
  return { href: url.slice(0, -match[1].length), trailing: match[1] };
}

/** Turn plain-text URLs into anchor tags (input must be plain text, not HTML). */
export function linkifyPlainTextToHtml(text: string): string {
  if (!text) return "";

  let out = "";
  let lastIndex = 0;

  for (const match of Array.from(text.matchAll(PLAIN_URL_RE))) {
    const start = match.index ?? 0;
    const raw = match[0];
    out += escapeHtmlText(text.slice(lastIndex, start));

    const { href, trailing } = trimTrailingPunctuation(raw);
    const safeHref = href.replace(/"/g, "&quot;");
    out += `<a href="${safeHref}" target="_blank" rel="noopener noreferrer">${escapeHtmlText(href)}</a>`;
    if (trailing) out += escapeHtmlText(trailing);
    lastIndex = start + raw.length;
  }

  out += escapeHtmlText(text.slice(lastIndex));
  return out;
}

/**
 * Linkify bare http(s) URLs in HTML fragments without touching tag attributes.
 * Skips text that is already inside an anchor tag.
 */
export function linkifyBareUrlsInHtml(html: string): string {
  if (!html || !PLAIN_URL_RE.test(html)) return html;
  PLAIN_URL_RE.lastIndex = 0;

  const parts = html.split(/(<[^>]+>)/g);
  let insideAnchor = false;
  return parts
    .map((part) => {
      if (part.startsWith("<")) {
        if (/^<\s*\/\s*a\b/i.test(part)) insideAnchor = false;
        else if (/^<\s*a\b/i.test(part)) insideAnchor = true;
        return part;
      }
      if (insideAnchor) return part;
      return linkifyPlainTextToHtml(part);
    })
    .join("");
}
