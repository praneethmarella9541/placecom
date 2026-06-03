"use client";

import { useMemo, useRef, useState, useEffect } from "react";
import { titleCase } from "@/lib/title-case";
import {
  rewriteCidImageUrls,
  type InlineImageAttachment,
} from "@/lib/email-html-inline-images";

/** Strip scripts and inline event handlers — email must not execute JS. */
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

function buildSrcdoc(styles: string, body: string): string {
  return `<!DOCTYPE html>
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
    pre { white-space: pre-wrap; overflow-x: auto; font-family: "Roboto Mono", "Courier New", monospace; font-size: 13px; }
    table { border-collapse: collapse; }
    td, th { vertical-align: top; }
    /* Notify parent when layout settles */
    html { height: auto; }
    ${styles}
  </style>
</head>
<body>
  <div class="email_message_body">${body}</div>
  <script>
    function notifyHeight() {
      const h = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 40);
      window.parent.postMessage({ type: 'email-height', height: h }, '*');
    }
    // Fire immediately, then after images load
    notifyHeight();
    window.addEventListener('load', notifyHeight);
    new MutationObserver(notifyHeight).observe(document.body, { childList: true, subtree: true, attributes: true });
    document.querySelectorAll('img').forEach(img => {
      if (!img.complete) {
        img.addEventListener('load', notifyHeight);
        img.addEventListener('error', notifyHeight);
      }
    });
  </script>
</body>
</html>`;
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
  const [height, setHeight] = useState(120);

  const srcdoc = useMemo(() => {
    if (!html) return null;
    const { styles, body: rawBody } = prepareEmailFragment(html);
    const body =
      messageId && attachments?.length
        ? rewriteCidImageUrls(rawBody, messageId, attachments)
        : rawBody;
    return buildSrcdoc(styles, body);
  }, [html, messageId, attachments]);

  // Listen for height messages from the iframe script
  useEffect(() => {
    if (!srcdoc) return;
    const handler = (e: MessageEvent) => {
      if (
        e.data &&
        typeof e.data === "object" &&
        e.data.type === "email-height" &&
        typeof e.data.height === "number"
      ) {
        setHeight((prev) => {
          const next = e.data.height + 8;
          return Math.abs(next - prev) > 2 ? next : prev;
        });
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [srcdoc]);

  // Fallback: plain text
  if (!html || !srcdoc) {
    return (
      <div className="mt-3 max-w-[680px] whitespace-pre-wrap break-words font-sans text-[14px] leading-relaxed text-[var(--color-text)]">
        {plain || "(empty body)"}
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      className="mt-3 w-full border-0 bg-white"
      style={{ height: `${height}px`, minHeight: 40 }}
      title={titleCase("Email body")}
    />
  );
}
