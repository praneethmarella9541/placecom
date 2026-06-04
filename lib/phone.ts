/** Normalise to E.164-style (+country digits). */
export function normalizePhone(raw: string): string {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (!cleaned) return "";
  if (cleaned.startsWith("+")) return cleaned;
  if (/^\d{10}$/.test(cleaned)) return `+91${cleaned}`;
  if (/^0\d{10}$/.test(cleaned)) return `+91${cleaned.slice(1)}`;
  if (/^\d{11,14}$/.test(cleaned)) return `+${cleaned}`;
  return cleaned;
}

export function isValidE164(input: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhone(input));
}

/** Compare numbers ignoring formatting and optional +91 prefix. */
export function phoneMatches(a: string, b: string): boolean {
  const na = normalizePhone(a);
  const nb = normalizePhone(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const strip = (p: string) => p.replace(/^\+91/, "").replace(/^\+/, "");
  return strip(na) === strip(nb);
}

export function phoneLookupVariants(raw: string): string[] {
  const normalized = normalizePhone(raw);
  if (!normalized) return [];
  const digits = normalized.replace(/^\+91/, "").replace(/^\+/, "");
  const variants = [
    raw,
    normalized,
    `+91${digits}`,
    digits,
    `0${digits}`,
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);
  return variants;
}
