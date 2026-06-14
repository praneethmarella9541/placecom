/** Indian mobile / plausible CRM phone — excludes long security IDs and tokens. */
export function isExtractablePhone(raw: string): boolean {
  const cleaned = raw.replace(/[\s\-().]/g, "");
  if (!cleaned || !/\d/.test(cleaned)) return false;

  // Bare 12+ digit strings are usually security codes, order IDs, timestamps — not phones.
  if (/^\d{12,}$/.test(cleaned)) return false;

  if (/^[6-9]\d{9}$/.test(cleaned)) return true;
  if (/^0[6-9]\d{9}$/.test(cleaned)) return true;
  if (/^91[6-9]\d{9}$/.test(cleaned)) return true;
  if (/^\+91[6-9]\d{9}$/.test(cleaned)) return true;

  // Indian toll-free (1800 / 1860 …)
  if (/^1(800|860|865)\d{7}$/.test(cleaned)) return true;

  // International E.164 with explicit country code
  if (/^\+[1-9]\d{9,14}$/.test(cleaned)) return true;

  return false;
}

export function sanitizeExtractedPhones(phones: string[]): string[] {
  return phones.filter((p) => isExtractablePhone(p));
}

export function sanitizeContactPhone<T extends { phone: string | null }>(contact: T): T {
  if (!contact.phone || isExtractablePhone(contact.phone)) return contact;
  return { ...contact, phone: null };
}

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
