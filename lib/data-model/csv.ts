/** CSV writing. Pure; tested in csv.test.mts. */

/**
 * One CSV cell. Quotes when needed, and defuses spreadsheet formulas: a cell starting with = + - @
 * (or a tab or carriage return) would run as a formula when opened in Excel or Sheets, so it gets a
 * leading apostrophe. Numbers that merely start with a minus sign are left alone.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let text = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(text) && !(typeof value === "number") && !/^-?\d+(\.\d+)?$/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: unknown[]): string {
  return cells.map(csvCell).join(",");
}

/**
 * Parse CSV text into rows of cells (RFC 4180): quoted cells, doubled quotes, commas and newlines
 * inside quotes, CRLF or LF, an optional byte-order mark. Blank lines are skipped. Pure.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let wasQuoted = false;

  const endCell = () => {
    row.push(cell);
    cell = "";
    wasQuoted = false;
  };
  const endRow = () => {
    endCell();
    // A line with nothing on it (one empty, unquoted cell) is not a row.
    if (!(row.length === 1 && row[0] === "" && !wasQuoted)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === "") {
      quoted = true;
      wasQuoted = true;
    } else if (ch === ",") endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0 || wasQuoted) endRow();
  return rows;
}

/**
 * Guess which attribute each CSV header means, by name or slug, ignoring case, spacing and
 * punctuation. Returns, per header, an attribute slug, "name" for the record name, or null.
 */
export function guessMapping(headers: string[], attrs: { slug: string; name: string }[]): (string | null)[] {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const used = new Set<string>();
  return headers.map((h) => {
    const n = norm(h);
    if (!n) return null;
    let hit: string | null = null;
    if (!used.has("name") && ["name", "fullname", "contactname", "candidatename"].includes(n)) hit = "name";
    else {
      const a = attrs.find((x) => !used.has(x.slug) && (norm(x.name) === n || norm(x.slug) === n));
      if (a) hit = a.slug;
      else if (!used.has("email_addresses") && ["email", "emailaddress", "mail"].includes(n) && attrs.some((x) => x.slug === "email_addresses")) hit = "email_addresses";
      else if (!used.has("phone_numbers") && ["phone", "mobile", "phonenumber", "contactnumber"].includes(n) && attrs.some((x) => x.slug === "phone_numbers")) hit = "phone_numbers";
    }
    if (hit) used.add(hit);
    return hit;
  });
}
