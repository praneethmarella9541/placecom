"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { titleCase } from "@/lib/title-case";
import {
  rewriteCidImageUrls,
  type InlineImageAttachment,
} from "@/lib/email-html-inline-images";

const MEASURE_ROOT_ID = "email-measure-root";

function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** Strip html/body height rules and viewport min-heights that grow with the iframe. */
function sanitizeExtractedStyles(css: string): string {
  let out = css.replace(/min-height\s*:\s*100vh(\s*!important)?/gi, "min-height:auto$1");
  out = out.replace(/height\s*:\s*100vh(\s*!important)?/gi, "height:auto$1");
  out = out.replace(
    /(?:^|})\s*(?:html|body)(?:\s*,\s*(?:html|body))?\s*\{[^}]*\}/gi,
    ""
  );
  return out;
}

function prepareEmailFragment(html: string): { styles: string; body: string } {
  const styles: string[] = [];
  let fragment = sanitizeEmailHtml(html);

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

function measureContentRoot(doc: Document): number {
  const root = doc.getElementById(MEASURE_ROOT_ID);
  const html = doc.documentElement;
  const body = doc.body;
  if (!root || !body) return 40;

  // Keep the iframe document from stretching with the outer iframe height.
  html.style.height = "auto";
  body.style.height = "auto";

  return Math.max(
    root.scrollHeight,
    root.offsetHeight,
    root.getBoundingClientRect().height,
    40
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
    const { styles, body: rawBody } = prepareEmailFragment(html);
    const body =
      messageId && attachments?.length
        ? rewriteCidImageUrls(rawBody, messageId, attachments)
        : rawBody;
    return { styles, body };
  }, [html, messageId, attachments]);

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
    html, body {
      margin: 0; padding: 0;
      overflow: hidden;
    }
    body {
      overflow-wrap: break-word;
      word-wrap: break-word;
    }
    img { max-width: 100%; }
    #${MEASURE_ROOT_ID} { display: block; }
    ${prepared.styles}
  </style>
  <style>
    /* After sender styles — prevent iframe height feedback loops */
    html, body {
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: hidden !important;
    }
  </style>
</head>
<body><div id="${MEASURE_ROOT_ID}">${prepared.body}</div></body>
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
    let resizePasses = 0;
    const MAX_RESIZE_PASSES = 24;

    const applyHeight = () => {
      if (resizePasses >= MAX_RESIZE_PASSES) return;
      resizePasses += 1;

      const h = Math.ceil(measureContentRoot(doc));
      if (Math.abs(h - lastMeasured) < 2) return;
      lastMeasured = h;
      setHeight(h);
    };

    applyHeight();

    const root = doc.getElementById(MEASURE_ROOT_ID);
    let mo: MutationObserver | null = null;
    if (root && typeof MutationObserver !== "undefined") {
      mo = new MutationObserver(() => applyHeight());
      mo.observe(root, { childList: true, subtree: true });
    }

    const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>("img"));
    for (const img of imgs) {
      if (!img.complete) {
        img.addEventListener("load", applyHeight, { once: true });
        img.addEventListener("error", applyHeight, { once: true });
      }
    }

    const t1 = window.setTimeout(applyHeight, 200);
    const t2 = window.setTimeout(applyHeight, 800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      mo?.disconnect();
      doc.removeEventListener("click", onLinkClick, true);
    };
  }, [prepared]);

  if (!html || !prepared) {
    return (
      <div className="mt-3 max-w-[680px] whitespace-pre-wrap break-words text-[14px] leading-relaxed text-[#202124]">
        {plain || "(empty body)"}
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="mt-1 w-full border-0 bg-transparent"
      style={{ height: `${height}px`, minHeight: 40 }}
      title={titleCase("Email body")}
    />
  );
}
