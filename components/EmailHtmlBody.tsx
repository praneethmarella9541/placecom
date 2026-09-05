"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { titleCase } from "@/lib/title-case";
import {
  rewriteCidImageUrls,
  type InlineImageAttachment,
} from "@/lib/email-html-inline-images";
import { linkifyBareUrlsInHtml, linkifyPlainTextToHtml } from "@/lib/linkify-plain-text";
import { collapseQuotedHtml, splitPlainTextQuote } from "@/lib/email-quote-collapse";

function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** Neutralize only viewport-height rules that couple to iframe size (feedback loops). */
function sanitizeExtractedStyles(css: string): string {
  return css
    .replace(/min-height\s*:\s*100vh(\s*!important)?/gi, "min-height:auto$1")
    .replace(/height\s*:\s*100vh(\s*!important)?/gi, "height:auto$1");
}

function prepareEmailFragment(html: string): { styles: string; body: string } {
  const styles: string[] = [];
  let fragment = html;

  fragment = fragment.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => {
    styles.push(sanitizeExtractedStyles(css));
    return "";
  });

  const bodyMatch = fragment.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) fragment = bodyMatch[1];

  fragment = fragment
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");

  return { styles: styles.join("\n"), body: fragment.trim() };
}

function isHiddenForHeight(el: Element, doc: Document): boolean {
  const view = doc.defaultView;
  if (!view) return false;
  const style = view.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return true;
  if (parseFloat(style.opacity) === 0) return true;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 && rect.height <= 0) return true;
  if (rect.width <= 1 && rect.height <= 1) return true;
  return false;
}

function measureVisibleEmailHeight(doc: Document): number {
  const html = doc.documentElement;
  const body = doc.body;
  if (!body) return 40;

  html.style.height = "auto";
  html.style.minHeight = "0";
  body.style.height = "auto";
  body.style.minHeight = "0";

  const bodyTop = body.getBoundingClientRect().top;
  let maxBottom = bodyTop;

  for (const el of Array.from(body.querySelectorAll("*"))) {
    if (isHiddenForHeight(el, doc)) continue;
    const rect = el.getBoundingClientRect();
    if (rect.bottom > maxBottom) maxBottom = rect.bottom;
  }

  const bodyRect = body.getBoundingClientRect();
  if (bodyRect.bottom > maxBottom) maxBottom = bodyRect.bottom;

  const visible = Math.ceil(maxBottom - bodyTop);
  const scroll = body.scrollHeight;

  if (scroll > visible + 80) return Math.max(visible, 40);
  return Math.max(visible, scroll, 40);
}

/** Fetch authenticated attachment URLs and swap to blob: (iframe img cookies can fail). */
async function hydrateAttachmentImages(
  doc: Document,
  onUpdate: () => void,
): Promise<void> {
  const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>("img"));
  await Promise.all(
    imgs.map(async (img) => {
      const src = img.getAttribute("src") ?? "";
      if (!src.includes("/api/gmail/attachment") || img.dataset.hydrated === "1") return;
      try {
        const res = await fetch(src, { credentials: "include", cache: "no-store" });
        if (!res.ok) return;
        const blob = await res.blob();
        img.src = URL.createObjectURL(blob);
        img.dataset.hydrated = "1";
        onUpdate();
      } catch {
        /* ignore */
      }
    }),
  );
}

export function EmailHtmlBody({
  html,
  plain,
  messageId,
  attachments,
}: {
  html?: string;
  plain?: string;
  messageId?: string;
  attachments?: InlineImageAttachment[];
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);

  const prepared = useMemo(() => {
    if (!html) return null;
    let fragment = sanitizeEmailHtml(html);
    if (messageId && attachments?.length) {
      fragment = rewriteCidImageUrls(fragment, messageId, attachments);
    }
    const prepared = prepareEmailFragment(fragment);
    return {
      styles: prepared.styles,
      // Collapsed behind a "···" toggle after linkifying, not before — the
      // linkifier only rewrites bare URL text nodes, so running it first vs.
      // after the split makes no difference to matching, and doing it once
      // over the whole fragment is simpler than tracking two pieces through it.
      body: collapseQuotedHtml(linkifyBareUrlsInHtml(prepared.body)),
    };
  }, [html, messageId, attachments]);

  // Plain-text bodies don't go through the HTML quote-marker path above (no
  // gmail_quote div to find) — quoted history there is just lines starting
  // with ">" or an "On … wrote:" attribution. Split first, then linkify each
  // half, so the toggle wraps real HTML rather than a raw-text seam.
  const plainSplit = useMemo(() => splitPlainTextQuote(plain ?? ""), [plain]);
  const linkifiedPlain = useMemo(
    () => (plainSplit.main ? linkifyPlainTextToHtml(plainSplit.main) : ""),
    [plainSplit.main]
  );
  const linkifiedPlainQuoted = useMemo(
    () => (plainSplit.quoted ? linkifyPlainTextToHtml(plainSplit.quoted) : ""),
    [plainSplit.quoted]
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !prepared) return;

    const doc = iframe.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_blank">
  <style>
    html, body { margin: 0; padding: 0; }
    body { overflow-wrap: break-word; word-wrap: break-word; }
    img { max-width: 100%; height: auto; }
    /* Gmail-style "···" quoted-history toggle — see lib/email-quote-collapse.ts. */
    details.__quote-toggle { margin: 4px 0; }
    details.__quote-toggle > summary {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 18px;
      border-radius: 3px;
      background: #f1f3f4;
      color: #444;
      font-size: 13px;
      line-height: 1;
      cursor: pointer;
      list-style: none;
    }
    details.__quote-toggle > summary::-webkit-details-marker { display: none; }
    details.__quote-toggle > summary:hover { background: #e8eaed; }
    details.__quote-toggle[open] > summary { margin-bottom: 6px; }
    ${prepared.styles}
  </style>
  <style>
    html, body {
      height: auto !important;
      min-height: 0 !important;
    }
  </style>
</head>
<body>${prepared.body}</body>
</html>`);
    doc.close();

    const onLinkClick = (e: Event) => {
      const anchor = (e.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;
      let abs: string;
      try { abs = new URL(href, doc.baseURI).toString(); } catch { abs = href; }
      if (/^(mailto|tel|sms):/i.test(abs)) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(abs, "_blank", "noopener,noreferrer");
    };
    doc.addEventListener("click", onLinkClick, true);

    let lastMeasured = 0;
    let stablePasses = 0;
    let updatePasses = 0;
    const MAX_UPDATES = 16;
    let rafId = 0;
    let cancelled = false;

    const applyHeight = (opts?: { force?: boolean }) => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        // The pass cap exists to stop a runaway reflow loop during initial
        // async settling (images, webfonts) — not to gatekeep a discrete user
        // click. A quote toggle opening after that budget is already spent
        // (a long thread with several images loading) must still resize.
        if (cancelled || (updatePasses >= MAX_UPDATES && !opts?.force)) return;
        updatePasses += 1;

        const h = measureVisibleEmailHeight(doc);
        if (Math.abs(h - lastMeasured) <= 2 && !opts?.force) {
          // Same-height re-measures are skipped to avoid a pointless
          // re-render — but a forced (toggle-triggered) call always commits:
          // a click must never silently no-op just because this heuristic
          // guessed the delta was negligible.
          stablePasses += 1;
          if (stablePasses >= 2) return;
        } else {
          stablePasses = 0;
          lastMeasured = h;
          setHeight(h);
        }
      });
    };

    applyHeight();

    // Opening/closing a collapsed quote block (see lib/email-quote-collapse.ts)
    // changes the document's content height well after the initial measuring
    // passes above have settled — without this, the fixed-height,
    // scrolling="no" iframe would clip the newly revealed content.
    const onToggle = () => applyHeight({ force: true });
    doc.addEventListener("toggle", onToggle, true);

    // Explicit no-arg wrapper: addEventListener/setTimeout call their handler
    // with an Event or nothing, and TS (rightly) won't let that flow into
    // applyHeight's `{ force?: boolean }` parameter.
    const remeasure = () => applyHeight();

    const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>("img"));
    for (const img of imgs) {
      if (!img.complete) {
        img.addEventListener("load", remeasure, { once: true });
        img.addEventListener("error", remeasure, { once: true });
      }
    }

    void hydrateAttachmentImages(doc, remeasure);

    const t1 = window.setTimeout(remeasure, 150);
    const t2 = window.setTimeout(remeasure, 600);
    const t3 = window.setTimeout(remeasure, 1500);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      cancelAnimationFrame(rafId);
      doc.removeEventListener("click", onLinkClick, true);
      doc.removeEventListener("toggle", onToggle, true);
    };
  }, [prepared]);

  if (!html || !prepared) {
    return (
      <div className="mt-3 max-w-[680px] text-[14px] leading-relaxed text-[#202124]">
        <div
          className="whitespace-pre-wrap break-words [&_a]:text-[#1a73e8] [&_a]:underline"
          dangerouslySetInnerHTML={{ __html: linkifiedPlain || "(empty body)" }}
        />
        {linkifiedPlainQuoted && (
          <details className="mt-1 [&_summary]:list-none [&_summary::-webkit-details-marker]:hidden">
            <summary
              aria-label={titleCase("Show quoted text")}
              className="inline-flex h-[18px] w-[26px] cursor-pointer items-center justify-center rounded text-[13px] text-[#444] hover:bg-[#e8eaed] [background:#f1f3f4]"
            >
              ⋯
            </summary>
            <div
              className="mt-2 whitespace-pre-wrap break-words [&_a]:text-[#1a73e8] [&_a]:underline"
              dangerouslySetInnerHTML={{ __html: linkifiedPlainQuoted }}
            />
          </details>
        )}
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      scrolling="no"
      className="mt-1 w-full border-0 bg-transparent"
      style={{ height: `${height}px`, minHeight: 40 }}
      title={titleCase("Email body")}
    />
  );
}
