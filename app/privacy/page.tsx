import fs from "node:fs";
import path from "node:path";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy | The Nucleus",
  description: "Privacy Policy for XLRI-CRM / The Nucleus.",
};

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

function renderMarkdown(markdown: string) {
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
      output.push(`<blockquote>${quoteLines.map((line) => `<p>${renderInline(line)}</p>`).join("")}</blockquote>`);
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

export default function PrivacyPolicyPage() {
  const policy = fs.readFileSync(path.join(process.cwd(), "PRIVACY_POLICY.md"), "utf8");

  return (
    <main className="min-h-screen bg-[var(--color-bg)] px-4 py-8 text-[var(--color-text)] sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <a
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-[15px] font-semibold text-[var(--color-copper)] transition-colors hover:text-[var(--color-copper-hover)]"
        >
          <span aria-hidden="true">&larr;</span> The Nucleus
        </a>

        <article
          className="privacy-policy surface-card overflow-hidden rounded-[var(--radius-xl)] p-5 sm:p-8 lg:p-10"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(policy) }}
        />
      </div>
    </main>
  );
}
