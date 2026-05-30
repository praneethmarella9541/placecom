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

  const resolve = (cid: string): string | null => {
    const att = cidMap.get(normalizeContentId(cid));
    return att ? attachmentProxyUrl(messageId, att) : null;
  };

  let out = html.replace(/\bsrc=(["'])cid:([^"']+)\1/gi, (match, _q, cid: string) => {
    const url = resolve(cid);
    return url ? `src="${url}"` : match;
  });

  out = out.replace(/\bbackground=(["'])cid:([^"']+)\1/gi, (match, _q, cid: string) => {
    const url = resolve(cid);
    return url ? `background="${url}"` : match;
  });

  out = out.replace(/url\(\s*(["']?)cid:([^"')]+)\1\s*\)/gi, (match, _q, cid: string) => {
    const url = resolve(cid);
    return url ? `url("${url}")` : match;
  });

  return out;
}
