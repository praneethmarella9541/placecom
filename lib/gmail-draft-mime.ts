import { draftSubjectForMime } from "@/lib/gmail-draft-subject";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");
}

function htmlToPlain(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function buildAlternativeMime(opts: {
  textBody: string;
  htmlBody?: string;
}): { altBoundary: string; altPart: string } {
  const altBoundary = "----=_DraftAlt_001";
  const usingRichHtml = !!opts.htmlBody && opts.htmlBody.trim().length > 0;
  const plain = usingRichHtml ? htmlToPlain(opts.htmlBody!) : opts.textBody;
  const html = usingRichHtml
    ? opts.htmlBody!
    : `<div style="font-family:sans-serif;font-size:14px;line-height:1.6">${escapeHtml(opts.textBody)}</div>`;

  const altPart = [
    `--${altBoundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    plain,
    `--${altBoundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${altBoundary}--`,
  ].join("\r\n");

  return { altBoundary, altPart };
}

function replaceHeaderLine(headers: string, name: string, value: string): string {
  const re = new RegExp(`^${name}:\\s*.*$`, "im");
  const line = `${name}: ${value}`;
  if (re.test(headers)) return headers.replace(re, line);
  return `${headers}\r\n${line}`;
}

function decodeRawBase64Url(raw: string): string {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64").toString("utf8");
}

function encodeRawBase64Url(mime: string): string {
  return Buffer.from(mime, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Update headers + body text on an existing draft MIME while keeping
 * attachment parts byte-identical (avoids re-uploading large files).
 */
export function rebuildDraftRawPreservingAttachments(
  existingRawBase64Url: string,
  opts: {
    to: string;
    cc?: string;
    bcc?: string;
    subject: string;
    textBody: string;
    htmlBody?: string;
  }
): string {
  const raw = decodeRawBase64Url(existingRawBase64Url);
  const sep = raw.indexOf("\r\n\r\n");
  if (sep === -1) {
    throw new Error("Invalid draft MIME");
  }

  let headerBlock = raw.slice(0, sep);
  const body = raw.slice(sep + 4);

  headerBlock = replaceHeaderLine(headerBlock, "To", opts.to);
  if (opts.cc?.trim()) headerBlock = replaceHeaderLine(headerBlock, "Cc", opts.cc.trim());
  if (opts.bcc?.trim()) headerBlock = replaceHeaderLine(headerBlock, "Bcc", opts.bcc.trim());
  headerBlock = replaceHeaderLine(headerBlock, "Subject", draftSubjectForMime(opts.subject));

  const mixedMatch = headerBlock.match(
    /Content-Type:\s*multipart\/mixed;\s*boundary="([^"]+)"/i
  );
  if (!mixedMatch) {
    throw new Error("Draft has no attachment structure to preserve");
  }

  const mixedBoundary = mixedMatch[1];
  const { altBoundary, altPart } = buildAlternativeMime({
    textBody: opts.textBody,
    htmlBody: opts.htmlBody,
  });

  const chunks = body.split(`--${mixedBoundary}`);
  const attachmentChunks: string[] = [];

  for (let i = 1; i < chunks.length; i++) {
    const chunk = chunks[i];
    if (!chunk || chunk.startsWith("--")) continue;
    if (/Content-Disposition:\s*attachment/i.test(chunk)) {
      attachmentChunks.push(`--${mixedBoundary}${chunk}`);
    }
  }

  const newAltWrapper = [
    `--${mixedBoundary}`,
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`,
    "",
    altPart,
  ].join("\r\n");

  const newBody = [
    newAltWrapper,
    ...attachmentChunks,
    `--${mixedBoundary}--`,
    "",
  ].join("\r\n");

  return encodeRawBase64Url(`${headerBlock}\r\n\r\n${newBody}`);
}
