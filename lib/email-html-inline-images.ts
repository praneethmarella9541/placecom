export type InlineImageAttachment = {
  attachmentId: string;
  filename: string;
  mimeType: string;
  contentId?: string;
};

function normalizeContentId(raw: string): string {
  return raw.replace(/^<|>$/g, "").trim().toLowerCase();
}

function attachmentProxyUrl(messageId: string, att: InlineImageAttachment): string {
  const params = new URLSearchParams({
    messageId,
    attachmentId: att.attachmentId,
    filename: att.filename || "inline",
    mimeType: att.mimeType || "application/octet-stream",
  });
  return `/api/gmail/attachment?${params.toString()}`;
}

function resolveCidAttachment(
  cid: string,
  cidMap: Map<string, InlineImageAttachment>,
): InlineImageAttachment | null {
  const key = normalizeContentId(cid);
  const direct = cidMap.get(key);
  if (direct) return direct;

  const keyBase = key.split("@")[0];
  for (const [stored, att] of Array.from(cidMap.entries())) {
    if (stored === key) return att;
    const storedBase = stored.split("@")[0];
    if (keyBase && storedBase && (storedBase === keyBase || stored.endsWith(key) || key.endsWith(stored))) {
      return att;
    }
  }
  return null;
}

/**
 * Replace `cid:` image references with authenticated attachment URLs so
 * marketing / transactional HTML renders like Gmail (banner logos, etc.).
 */
export function rewriteCidImageUrls(
  html: string,
  messageId: string,
  attachments: InlineImageAttachment[],
): string {
  if (!html || !messageId || !attachments.length) return html;

  const cidMap = new Map<string, InlineImageAttachment>();
  for (const att of attachments) {
    if (!att.contentId) continue;
    cidMap.set(normalizeContentId(att.contentId), att);
  }
  if (cidMap.size === 0) return html;

  const toUrl = (cid: string): string | null => {
    const att = resolveCidAttachment(cid, cidMap);
    return att ? attachmentProxyUrl(messageId, att) : null;
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
): boolean {
  if (!bodyHtml || !contentId) return false;
  const cid = normalizeContentId(contentId);
  const html = bodyHtml.toLowerCase();
  const base = cid.split("@")[0];
  return (
    html.includes(`cid:${cid}`) ||
    (base.length > 0 && html.includes(`cid:${base}`))
  );
}
