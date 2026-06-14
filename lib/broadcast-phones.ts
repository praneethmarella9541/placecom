import { splitCsvLine } from "@/lib/broadcast-recipients";
import { isValidE164, normalizePhone } from "@/lib/phone";

/** Column headers that identify a phone column in broadcast CSV/Excel. */
export const PHONE_HEADER_RE =
  /^(phone|mobile|tel|cell|whatsapp|e[-_]?164|msisdn|number|contact)$/i;

export function detectPhoneColumnIndex(headers: string[]): number {
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].trim();
    const stripped = h.replace(/[^a-zA-Z0-9]/g, "");
    if (PHONE_HEADER_RE.test(h) || PHONE_HEADER_RE.test(stripped)) return i;
  }
  return 0;
}

export function detectBroadcastSpreadsheetKind(file: File): "csv" | "excel" | null {
  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();
  if (name.endsWith(".csv") || type === "text/csv" || type === "application/csv") return "csv";
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    name.endsWith(".ods") ||
    type.includes("spreadsheet") ||
    type === "application/vnd.ms-excel"
  ) {
    return "excel";
  }
  return null;
}

function stripBom(s: string): string {
  return s.replace(/^\uFEFF/, "").trim();
}

/** Excel serial / plain digits — avoid scientific notation losing mobile digits. */
function excelCellToPhoneString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(Math.trunc(value));
  }
  return stripBom(String(value));
}

/** E.164-like segments in free text (incl. spaced / dashed). */
const PHONE_PLUS_RE = /\+[\d\s().-]{7,22}/g;

/** WhatsApp-style channel addresses in pasted text. */
const WHATSAPP_ADDR_RE = /whatsapp:\s*\+?[\d\s().-]{7,22}/gi;

export function normalizeToE164(input: string): string | null {
  let t = input.trim();
  if (!t) return null;
  t = t.replace(/^whatsapp:/i, "").trim();
  if (t.startsWith("00")) t = `+${t.slice(2)}`;
  const normalized = normalizePhone(t);
  return isValidE164(normalized) ? normalized : null;
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

export function parsePhonesFromTable(headers: string[], dataRows: string[][]): string[] {
  const phoneCol = detectPhoneColumnIndex(headers);
  const out: string[] = [];

  for (const row of dataRows) {
    const rawPhone = excelCellToPhoneString(row[phoneCol]);
    const direct = normalizeToE164(rawPhone);
    if (direct) {
      out.push(direct);
      continue;
    }
    for (const cell of row) {
      const n = normalizeToE164(excelCellToPhoneString(cell));
      if (n) {
        out.push(n);
        break;
      }
    }
  }

  return Array.from(new Set(out));
}

function headerLooksLikePhoneColumn(headers: string[]): boolean {
  return headers.some((h) => {
    const t = h.trim();
    const stripped = t.replace(/[^a-zA-Z0-9]/g, "");
    return PHONE_HEADER_RE.test(t) || PHONE_HEADER_RE.test(stripped);
  });
}

export function parsePhonesFromCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const headers = splitCsvLine(lines[0]).map((c) => stripBom(c).trim());
  if (headerLooksLikePhoneColumn(headers) && lines.length >= 2) {
    const dataRows = lines.slice(1).map((l) => splitCsvLine(l).map((c) => stripBom(c).trim()));
    return parsePhonesFromTable(headers, dataRows);
  }

  const out: string[] = [];
  for (const line of lines) {
    const cells = splitCsvLine(line).map((c) => stripBom(c).trim());
    for (const cell of cells) {
      const n = normalizeToE164(cell);
      if (n) {
        out.push(n);
        break;
      }
    }
  }
  return Array.from(new Set(out));
}
