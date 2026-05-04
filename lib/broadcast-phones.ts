import { splitCsvLine } from "@/lib/broadcast-recipients";

/** E.164-like segments in free text (incl. spaced / dashed). */
const PHONE_PLUS_RE = /\+[\d\s().-]{7,22}/g;

/** WhatsApp-style channel addresses in pasted text. */
const WHATSAPP_ADDR_RE = /whatsapp:\s*\+?[\d\s().-]{7,22}/gi;

export function normalizeToE164(input: string): string | null {
  let t = input.trim();
  t = t.replace(/^whatsapp:/i, "").replace(/[\s()-]/g, "");
  if (t.startsWith("00")) t = `+${t.slice(2)}`;
  if (!t.startsWith("+")) {
    const digits = t.replace(/\D/g, "");
    if (digits.length === 10) t = `+1${digits}`;
    else if (digits.length >= 8 && digits.length <= 15) t = `+${digits}`;
    else return null;
  }
  const digits = t.slice(1).replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

export function isValidE164Phone(s: string): boolean {
  return normalizeToE164(s) !== null;
}

/** Split pasted list: commas, semicolons, newlines, spaces between +numbers. */
export function normalizePhoneList(raw: string): string[] {
  const parts = raw
    .split(/[\n,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    const n = normalizeToE164(p);
    if (n) out.push(n);
  }
  return Array.from(new Set(out));
}

export function extractPhonesFromText(text: string): string[] {
  const out: string[] = [];
  for (const m of text.match(WHATSAPP_ADDR_RE) || []) {
    const n = normalizeToE164(m);
    if (n) out.push(n);
  }
  const stripped = text.replace(WHATSAPP_ADDR_RE, " ");
  PHONE_PLUS_RE.lastIndex = 0;
  for (const m of stripped.match(PHONE_PLUS_RE) || []) {
    const n = normalizeToE164(m);
    if (n) out.push(n);
  }
  return Array.from(new Set(out));
}

export function parsePhonesFromCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const out: string[] = [];
  let start = 0;
  const firstCells = splitCsvLine(lines[0]);
  const phoneHeaderIdx = firstCells.findIndex((h) =>
    /^(phone|mobile|tel|cell|whatsapp|e-?164|msisdn)$/i.test(h.trim()),
  );
  if (phoneHeaderIdx >= 0) start = 1;

  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (phoneHeaderIdx >= 0 && cells[phoneHeaderIdx]) {
      const n = normalizeToE164(cells[phoneHeaderIdx]);
      if (n) out.push(n);
      continue;
    }
    for (const cell of cells) {
      const found = extractPhonesFromText(cell);
      if (found.length) {
        out.push(...found);
        break;
      }
    }
  }
  return Array.from(new Set(out));
}
