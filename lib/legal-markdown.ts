/**
 * Tiny server-side markdown → HTML for the standalone legal pages (/privacy,
 * /account-deletion). Deliberately minimal: headings, `- ` lists, `> ` quotes,
 * **bold**, [links](url), and `code`. The source files are hand-written and
 * trusted, but everything still goes through escapeHtml first.
 */

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderInline(value: string) {
  return escapeHtml(value)
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function renderLegalMarkdown(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const output: string[] = [];
  let listItems: string[] = [];
  let quoteLines: string[] = [];

  const flushList = () => {
    if (listItems.length) {
      output.push(`<ul>${listItems.join("")}</ul>`);
      listItems = [];
    }
  };
  const flushQuote = () => {
    if (quoteLines.length) {
      output.push(
        `<blockquote>${quoteLines.map((line) => `<p>${renderInline(line)}</p>`).join("")}</blockquote>`,
      );
      quoteLines = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith("> ")) {
      flushList();
      quoteLines.push(line.slice(2));
      continue;
    }
    flushQuote();
    const listMatch = line.match(/^- (.+)$/);
    if (listMatch) {
      listItems.push(`<li>${renderInline(listMatch[1])}</li>`);
      continue;
    }
    flushList();
    if (!line.trim()) continue;
    if (line.startsWith("### ")) {
      output.push(`<h3>${renderInline(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      output.push(`<h2>${renderInline(line.slice(3))}</h2>`);
    } else if (line.startsWith("# ")) {
      output.push(`<h1>${renderInline(line.slice(2))}</h1>`);
    } else {
      output.push(`<p>${renderInline(line)}</p>`);
    }
  }
  flushQuote();
  flushList();
  return output.join("");
}
