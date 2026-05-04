/** Loose email pattern for list parsing (not full RFC validation). */
const EMAIL_RE = /\b[A-Za-z0-9][A-Za-z0-9._%+-]*@[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b/g;

export function isValidEmail(s: string): boolean {
  const t = s.trim();
  if (!t || t.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

export function normalizeEmailList(raw: string): string[] {
  const parts = raw
    .split(/[\s,;]+/)
    .map((p) => p.trim().replace(/^<|>$/g, ""))
    .filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (isValidEmail(p)) out.push(p.toLowerCase());
  }
  return Array.from(new Set(out));
}

/** Extract emails from free text (one line can contain multiple). */
export function extractEmailsFromText(text: string): string[] {
  const matches = text.match(EMAIL_RE) || [];
  const out = matches.map((m) => m.toLowerCase()).filter(isValidEmail);
  return Array.from(new Set(out));
}

/** Split a CSV line respecting simple double-quoted fields. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && c === ",") {
      cells.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  cells.push(cur.trim());
  return cells.map((c) => c.replace(/^"|"$/g, ""));
}

export function parseEmailsFromCsv(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const out: string[] = [];
  let start = 0;
  const firstCells = splitCsvLine(lines[0]);
  const emailHeaderIdx = firstCells.findIndex((h) =>
    /^(e-?mail|email|mail)$/i.test(h.trim())
  );
  if (emailHeaderIdx >= 0) start = 1;

  for (let i = start; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    if (emailHeaderIdx >= 0 && cells[emailHeaderIdx]) {
      const e = cells[emailHeaderIdx].trim();
      if (isValidEmail(e)) out.push(e.toLowerCase());
      continue;
    }
    for (const cell of cells) {
      const found = cell.match(EMAIL_RE);
      if (found) {
        for (const m of found) {
          if (isValidEmail(m)) out.push(m.toLowerCase());
        }
        break;
      }
    }
  }
  return Array.from(new Set(out));
}
