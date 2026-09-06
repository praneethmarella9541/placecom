import type { ReactNode } from "react";

/**
 * Minimal, dependency-free Markdown -> JSX renderer.
 *
 * The project has no markdown library (react-markdown, remark, marked, …), and
 * pulling one in for a single static legal page felt like the wrong tradeoff —
 * this covers exactly the subset that page needs (headings, bold, links,
 * unordered lists, blockquotes, horizontal rules, paragraphs) and nothing more.
 * Not a general-purpose parser: no nested lists, ordered lists, tables, code
 * spans, or images. If a future document needs those, reach for a real
 * markdown library instead of extending this one block at a time.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  // Order matters: link syntax [text](url) is matched before bold so a bold
  // span inside link text still resolves — none of our content nests them,
  // but splitting on links first keeps the two passes independent either way.
  const linkRe = /\[([^\]]+)\]\(([^)]+)\)/g;
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  let i = 0;

  const renderBold = (segment: string, prefix: string): ReactNode[] => {
    const parts = segment.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
    return parts.map((part, idx) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <strong key={`${prefix}-b${idx}`} className="font-semibold text-[var(--color-text)]">
            {part.slice(2, -2)}
          </strong>
        );
      }
      return <span key={`${prefix}-t${idx}`}>{part}</span>;
    });
  };

  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > lastIndex) {
      nodes.push(...renderBold(text.slice(lastIndex, m.index), `${keyPrefix}-${i++}`));
    }
    const [, label, href] = m;
    const external = /^https?:\/\//i.test(href);
    nodes.push(
      <a
        key={`${keyPrefix}-a${i++}`}
        href={href}
        className="text-[var(--color-copper,#C45C1A)] underline underline-offset-2 hover:opacity-80"
        {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
      >
        {label}
      </a>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(...renderBold(text.slice(lastIndex), `${keyPrefix}-${i++}`));
  }
  return nodes;
}

type Block =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "hr" }
  | { type: "ul"; items: string[] }
  | { type: "blockquote"; text: string }
  | { type: "p"; text: string };

function parseBlocks(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push({ type: level === 1 ? "h1" : level === 2 ? "h2" : "h3", text: heading[2].trim() });
      i++;
      continue;
    }

    if (/^-\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^-\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^-\s+/, "").trim());
        i++;
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    if (/^>\s?/.test(line)) {
      const parts: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        parts.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", text: parts.join(" ").trim() });
      continue;
    }

    // Plain paragraph — consecutive non-blank, non-special lines join into one.
    const parts: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^-\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^---+$/.test(lines[i].trim())
    ) {
      parts.push(lines[i].trim());
      i++;
    }
    blocks.push({ type: "p", text: parts.join(" ") });
  }

  return blocks;
}

export function SimpleMarkdown({ markdown }: { markdown: string }) {
  const blocks = parseBlocks(markdown);

  return (
    <>
      {blocks.map((block, idx) => {
        const key = `block-${idx}`;
        switch (block.type) {
          case "h1":
            return (
              <h1 key={key} className="mb-2 text-[28px] font-bold leading-tight text-[var(--color-text)]">
                {renderInline(block.text, key)}
              </h1>
            );
          case "h2":
            return (
              <h2
                key={key}
                className="mb-3 mt-10 border-b border-[var(--color-border)] pb-2 text-[19px] font-semibold text-[var(--color-text)]"
              >
                {renderInline(block.text, key)}
              </h2>
            );
          case "h3":
            return (
              <h3 key={key} className="mb-2 mt-6 text-[15px] font-semibold text-[var(--color-text)]">
                {renderInline(block.text, key)}
              </h3>
            );
          case "hr":
            return <hr key={key} className="my-8 border-[var(--color-border)]" />;
          case "ul":
            return (
              <ul key={key} className="my-3 list-disc space-y-1.5 pl-5 text-[14px] leading-relaxed text-[var(--color-text-muted)]">
                {block.items.map((item, j) => (
                  <li key={`${key}-${j}`}>{renderInline(item, `${key}-${j}`)}</li>
                ))}
              </ul>
            );
          case "blockquote":
            return (
              <blockquote
                key={key}
                className="my-4 rounded-md border-l-4 border-[var(--color-copper,#C45C1A)] bg-[var(--color-surface-offset)] px-4 py-3 text-[13px] leading-relaxed text-[var(--color-text-muted)]"
              >
                {renderInline(block.text, key)}
              </blockquote>
            );
          case "p":
          default:
            return (
              <p key={key} className="my-3 text-[14px] leading-relaxed text-[var(--color-text-muted)]">
                {renderInline(block.text, key)}
              </p>
            );
        }
      })}
    </>
  );
}
