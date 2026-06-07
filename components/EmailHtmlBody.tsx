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
    return prepareEmailFragment(fragment);
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
    html, body { margin: 0; padding: 0; }
    body { overflow-wrap: break-word; word-wrap: break-word; }
    img { max-width: 100%; height: auto; }
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

    const applyHeight = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (cancelled || updatePasses >= MAX_UPDATES) return;
        updatePasses += 1;

        const h = measureVisibleEmailHeight(doc);
        if (Math.abs(h - lastMeasured) <= 2) {
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

    const imgs = Array.from(doc.querySelectorAll<HTMLImageElement>("img"));
    for (const img of imgs) {
      if (!img.complete) {
        img.addEventListener("load", applyHeight, { once: true });
        img.addEventListener("error", applyHeight, { once: true });
      }
    }

    void hydrateAttachmentImages(doc, applyHeight);

    const t1 = window.setTimeout(applyHeight, 150);
    const t2 = window.setTimeout(applyHeight, 600);
    const t3 = window.setTimeout(applyHeight, 1500);

    return () => {
      cancelled = true;
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      cancelAnimationFrame(rafId);
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
      scrolling="no"
      className="mt-1 w-full border-0 bg-transparent"
      style={{ height: `${height}px`, minHeight: 40 }}
      title={titleCase("Email body")}
    />
  );
}
