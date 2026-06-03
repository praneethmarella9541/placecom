"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { titleCase } from "@/lib/title-case";
import {
  rewriteCidImageUrls,
  type InlineImageAttachment,
} from "@/lib/email-html-inline-images";

function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

function prepareEmailFragment(html: string): { styles: string; body: string } {
  const styles: string[] = [];
  let fragment = sanitizeEmailHtml(html);

  fragment = fragment.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => {
    styles.push(css);
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

function measureDoc(doc: Document): number {
  // Temporarily clear height constraints so scrollHeight reflects true content
  const body = doc.body;
  const html = doc.documentElement;
  if (!body) return 80;
  const prevBodyH = body.style.height;
  const prevHtmlH = html.style.height;
  body.style.height = "auto";
  html.style.height = "auto";
  const h = Math.max(body.scrollHeight, html.scrollHeight, 40);
  body.style.height = prevBodyH;
  html.style.height = prevHtmlH;
  return h;
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

    // Write the full document
    doc.open();
    doc.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <base target="_blank">
  <style>
    html { color-scheme: light only; }
    html, body {
      margin: 0; padding: 0;
      background: #ffffff !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: visible;
    }
    body {
      font-family: "Roboto", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #202124;
      word-wrap: break-word;
      overflow-wrap: break-word;
      -webkit-text-size-adjust: 100%;
    }
    .email_message_body { display: block; }
    .gmail_quote, blockquote {
      margin: 8px 0 8px 0.8ex;
      padding-left: 1ex;
      border-left: 2px #dadce0 solid;
      color: #5f6368;
    }
    a { color: #1a73e8; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100%; border: 0; vertical-align: top; }
    pre { white-space: pre-wrap; overflow-x: auto; font-family: "Roboto Mono", monospace; font-size: 13px; }
    table { border-collapse: collapse; }
    td, th { vertical-align: top; }
    ${prepared.styles}
  </style>
</head>
<body><div class="email_message_body">${prepared.body}</div></body>
</html>`);
    doc.close();

    // Handle link clicks — open externally
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

    // Measure height using ResizeObserver on the body element — fires
    // whenever content reflows (images load, fonts render, etc.)
    const applyHeight = () => {
      const h = measureDoc(doc);
      setHeight(h + 4);
    };

    // Initial measure
    applyHeight();

    // Watch for size changes via ResizeObserver (much better than setTimeout polling)
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined" && doc.body) {
      ro = new ResizeObserver(applyHeight);
      ro.observe(doc.body);
    }

    // Also watch image loads in case ResizeObserver misses them
    const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>("img"));
    for (const img of imgs) {
      if (!img.complete) {
        img.addEventListener("load", applyHeight, { once: true });
        img.addEventListener("error", applyHeight, { once: true });
      }
    }

    // Fallback timeouts for web fonts / late-loading content
    const t1 = setTimeout(applyHeight, 200);
    const t2 = setTimeout(applyHeight, 800);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro?.disconnect();
      doc.removeEventListener("click", onLinkClick, true);
    };
  }, [prepared]);

  if (!html || !prepared) {
    return (
      <div className="mt-3 max-w-[680px] whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-[var(--color-text)]">
        {plain || "(empty body)"}
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="mt-1 w-full border-0 bg-white"
      style={{ height: `${height}px`, minHeight: 40 }}
      title={titleCase("Email body")}
    />
  );
}
