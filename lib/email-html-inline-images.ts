export type InlineImageAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  contentId?: string;
  /** Gmail inline part with base64 body.data (no attachmentId). */
  inlineDataUri?: string;
};

function normalizeContentId(raw: string): string {
  return raw.replace(/^<|>$/g, "").trim().toLowerCase();
}

function attachmentProxyUrl(messageId: string, att: InlineImageAttachment): string {
  if (att.inlineDataUri) return att.inlineDataUri;
  const params = new URLSearchParams({
    messageId,
    attachmentId: att.attachmentId,
    filename: att.filename || "inline",
    mimeType: att.mimeType || "application/octet-stream",
  });
  return `/api/gmail/attachment?${params.toString()}`;
}

function indexAttachment(
  cidMap: Map<string, InlineImageAttachment>,
  key: string,
  att: InlineImageAttachment,
): void {
  const norm = normalizeContentId(key);
  if (!norm) return;
  if (!cidMap.has(norm)) cidMap.set(norm, att);
  const base = norm.split("@")[0];
  if (base && !cidMap.has(base)) cidMap.set(base, att);
}

function extractCidRefs(html: string): string[] {
  const refs: string[] = [];
  const re = /cid:([^"'\s>)]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    refs.push(m[1]);
  }
  return refs;
}

function buildCidMap(
  html: string,
  attachments: InlineImageAttachment[],
): Map<string, InlineImageAttachment> {
  const cidMap = new Map<string, InlineImageAttachment>();
  for (const att of attachments) {
    if (att.contentId) indexAttachment(cidMap, att.contentId, att);
    const fn = att.filename?.trim();
    if (fn && fn.toLowerCase() !== "inline") {
      indexAttachment(cidMap, fn, att);
      const baseName = fn.replace(/\.[^.]+$/, "");
      if (baseName && baseName !== fn) indexAttachment(cidMap, baseName, att);
    }
  }

  const imageAttachments = attachments.filter((a) => a.mimeType.startsWith("image/"));
  const cidRefs = extractCidRefs(html);
  const uniqueCids = Array.from(new Set(cidRefs.map(normalizeContentId)));
  if (
    uniqueCids.length > 0 &&
    uniqueCids.length === imageAttachments.length &&
    uniqueCids.every((cid) => !resolveCidAttachment(cid, cidMap, attachments))
  ) {
    uniqueCids.forEach((cid, i) => indexAttachment(cidMap, cid, imageAttachments[i]!));
  }

  return cidMap;
}

function resolveCidAttachment(
  cid: string,
  cidMap: Map<string, InlineImageAttachment>,
  attachments: InlineImageAttachment[],
): InlineImageAttachment | null {
  const key = normalizeContentId(cid);
  const direct = cidMap.get(key);
  if (direct) return direct;

  const keyBase = key.split("@")[0];
  if (keyBase) {
    const byBase = cidMap.get(keyBase);
    if (byBase) return byBase;
  }

  for (const [stored, att] of Array.from(cidMap.entries())) {
    const storedBase = stored.split("@")[0];
    if (keyBase && storedBase && (storedBase === keyBase || stored.endsWith(key) || key.endsWith(stored))) {
      return att;
    }
  }

  for (const att of attachments) {
    const fn = att.filename?.trim().toLowerCase();
    if (!fn || fn === "inline") continue;
    if (key.includes(fn) || fn.includes(keyBase || key)) return att;
  }

  return null;
}

function attToUrl(messageId: string, att: InlineImageAttachment): string {
  return attachmentProxyUrl(messageId, att);
}

/**
 * Replace `cid:` image references with data URIs or authenticated attachment URLs.
 * Run on the full HTML string (before splitting body/styles).
 */
export function rewriteCidImageUrls(
  html: string,
  messageId: string,
  attachments: InlineImageAttachment[],
): string {
  if (!html || !messageId || !attachments.length) return html;
  if (!/cid:/i.test(html)) return html;

  const cidMap = buildCidMap(html, attachments);
  const imageAttachments = attachments.filter((a) => a.mimeType.startsWith("image/"));
  let imagePoolIdx = 0;

  const toUrl = (cid: string): string | null => {
    const att = resolveCidAttachment(cid, cidMap, attachments);
    if (att) return attToUrl(messageId, att);

    if (imagePoolIdx < imageAttachments.length) {
      const next = imageAttachments[imagePoolIdx++]!;
      return attToUrl(messageId, next);
    }
    return null;
  };

  let out = html.replace(/\bsrc=(["'])cid:([^"']+)\1/gi, (match, _q, cid: string) => {
    const url = toUrl(cid);
    return url ? `src="${url}"` : match;
  });

  out = out.replace(/\bsrc\s*=\s*cid:([^\s>"']+)/gi, (match, cid: string) => {
    const url = toUrl(cid);
    return url ? `src="${url}"` : match;
  });

  out = out.replace(/\bdata-src=(["'])cid:([^"']+)\1/gi, (match, _q, cid: string) => {
    const url = toUrl(cid);
    return url ? `data-src="${url}"` : match;
  });

  out = out.replace(/\bbackground=(["'])cid:([^"']+)\1/gi, (match, _q, cid: string) => {
    const url = toUrl(cid);
    return url ? `background="${url}"` : match;
  });

  out = out.replace(/url\(\s*(["']?)cid:([^"')]+)\1\s*\)/gi, (match, _q, cid: string) => {
    const url = toUrl(cid);
    return url ? `url("${url}")` : match;
  });

  return out;
}

/** True when a MIME part is embedded in HTML via `cid:` (Gmail hides these from the strip). */
export function isInlinePartReferencedInHtml(
  bodyHtml: string | undefined,
  contentId: string | undefined,
  filename?: string,
): boolean {
  if (!bodyHtml) return false;
  const html = bodyHtml.toLowerCase();
  if (contentId) {
    const cid = normalizeContentId(contentId);
    const base = cid.split("@")[0];
    if (html.includes(`cid:${cid}`) || (base.length > 0 && html.includes(`cid:${base}`))) {
      return true;
    }
  }
  const fn = filename?.trim().toLowerCase();
  if (fn && fn !== "inline" && html.includes(`cid:${fn}`)) return true;
  return false;
}
