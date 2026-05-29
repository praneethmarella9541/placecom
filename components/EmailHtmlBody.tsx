"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { titleCase } from "@/lib/title-case";

/** Strip scripts and inline event handlers — email must not execute JS. */
function sanitizeEmailHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** Measure rendered email height without growing with the iframe viewport. */
function measureEmailBodyHeight(doc: Document): number {
  const root = doc.querySelector<HTMLElement>(".email_message_body");
  if (!root) return 40;
  const prev = root.style.height;
  const prevMin = root.style.minHeight;
  const prevOverflow = root.style.overflow;
  root.style.height = "auto";
  root.style.minHeight = "0";
  root.style.overflow = "visible";
  const h = Math.ceil(root.scrollHeight);
  root.style.height = prev;
  root.style.minHeight = prevMin;
  root.style.overflow = prevOverflow;
  return Math.max(40, h);
}

/**
 * Pull embedded <style> blocks and optional <body> inner HTML out of a
 * message fragment so designer CSS is preserved (Gmail keeps these).
 */
function prepareEmailFragment(html: string): { styles: string; body: string } {
  const styles: string[] = [];
  let fragment = sanitizeEmailHtml(html);

  fragment = fragment.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_, css: string) => {
    styles.push(css);
    return "";
  });

  const bodyMatch = fragment.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  if (bodyMatch) fragment = bodyMatch[1];

  // Drop outer <html>/<head> wrappers if the message is a full document.
  fragment = fragment
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<head[^>]*>[\s\S]*?<\/head>/gi, "");

  return { styles: styles.join("\n"), body: fragment.trim() };
}

/**
 * Render HTML email bodies the way Gmail does: always light mode, preserve
 * sender styles, no forced table stretching, isolated sandboxed iframe.
 */
export function EmailHtmlBody({ html, plain }: { html?: string; plain?: string }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(80);

  const prepared = useMemo(
    () => (html ? prepareEmailFragment(html) : null),
    [html]
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !prepared?.body) return;
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
    /* Gmail renders messages on white — ignore app dark mode for email content */
    html { color-scheme: light only; }
    html, body {
      margin: 0; padding: 0;
      background: #ffffff !important;
      height: auto !important;
      min-height: 0 !important;
      max-height: none !important;
      overflow: hidden;
    }
    body {
      font-family: "Roboto", "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color: #202124;
      word-wrap: break-word;
      overflow-wrap: break-word;
      -webkit-text-size-adjust: 100%;
    }
    .email_message_body {
      display: block;
      height: auto !important;
      min-height: 0 !important;
    }
    .gmail_quote, blockquote {
      margin: 8px 0 8px 0.8ex;
      padding-left: 1ex;
      border-left: 1px #ccc solid;
      color: #500050;
    }
    a { color: #1155cc; text-decoration: none; }
    a:hover { text-decoration: underline; }
    img { max-width: 100% !important; height: auto !important; border: 0; }
    pre { white-space: pre-wrap; overflow-x: auto; }
    /* Do NOT force table width — marketing layouts break when width:100% */
    table { border-collapse: collapse; }
    td, th { vertical-align: top; }
    ${prepared.styles}
  </style>
</head>
<body>
  <div class="email_message_body">${prepared.body}</div>
</body>
</html>`);
    doc.close();

    const onLinkClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      const anchor = target.closest("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("#")) return;
      let abs: string;
      try {
        abs = new URL(href, doc.baseURI).toString();
      } catch {
        abs = href;
      }
      if (/^(mailto|tel|sms):/i.test(abs)) return;
      e.preventDefault();
      e.stopPropagation();
      window.open(abs, "_blank", "noopener,noreferrer");
    };
    doc.addEventListener("click", onLinkClick, true);

    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let lastMeasured = 0;
    let resizePasses = 0;
    const MAX_RESIZE_PASSES = 24;

    const applyHeight = (measured: number) => {
      const next = measured + 8;
      setHeight((prev) => (prev === next ? prev : next));
    };

    const resize = () => {
      if (!doc.body || resizePasses >= MAX_RESIZE_PASSES) return;
      const measured = measureEmailBodyHeight(doc);
      if (measured === lastMeasured) return;
      lastMeasured = measured;
      resizePasses += 1;
      applyHeight(measured);
    };

    const scheduleResize = () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        resize();
      }, 50);
    };

    const observer = new MutationObserver(scheduleResize);
    const root = doc.querySelector(".email_message_body");
    if (root) {
      // Only watch DOM inserts (e.g. lazy images). Attribute mutations caused
      // iframe height ↔ body min-height feedback loops (growing blank space).
      observer.observe(root, { childList: true, subtree: true });
    }
    iframe.addEventListener("load", scheduleResize);

    const attachImageListeners = () => {
      const imgs =
        doc.querySelector(".email_message_body")?.querySelectorAll<HTMLImageElement>("img") ??
        [];
      for (const img of Array.from(imgs)) {
        if (!img.complete) {
          img.addEventListener("load", scheduleResize, { once: true });
          img.addEventListener("error", scheduleResize, { once: true });
        }
      }
    };
    attachImageListeners();

    scheduleResize();
    const t1 = setTimeout(scheduleResize, 100);
    const t2 = setTimeout(scheduleResize, 400);
    const t3 = setTimeout(scheduleResize, 1200);

    return () => {
      if (resizeTimer) clearTimeout(resizeTimer);
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      observer.disconnect();
      iframe.removeEventListener("load", scheduleResize);
      doc.removeEventListener("click", onLinkClick, true);
    };
  }, [prepared]);

  if (!html || !prepared?.body) {
    return (
      <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-[#202124]">
        {plain || "(empty body)"}
      </pre>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="mt-2 w-full border-0 bg-white"
      style={{ height: `${height}px`, minHeight: 40, overflow: "hidden" }}
      title={titleCase("Email body")}
    />
  );
}
