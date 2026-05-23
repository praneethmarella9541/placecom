/**
 * Mail-merge placeholders: {{field_name}} or {field_name}
 * Field names are case-insensitive; use underscores in templates (e.g. {{first_name}}).
 */

const DOUBLE_BRACE_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const SINGLE_BRACE_RE = /\{\s*([a-zA-Z0-9_]+)\s*\}/g;

/** Normalize spreadsheet header → merge key (e.g. "First Name" → first_name). */
export function normalizeMergeFieldKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EMAIL_HEADER_KEYS = new Set([
  "email",
  "e_mail",
  "email_address",
  "email_id",
  "emailid",
  "mail_id",
  "mailid",
  "candidate_email",
  "official_email",
  "work_email",
  "personal_email",
]);

function headerLooksLikeEmailColumn(key: string): boolean {
  if (EMAIL_HEADER_KEYS.has(key)) return true;
  return key.includes("email");
}
const NAME_HEADER_KEYS = new Set(["name", "full_name", "fullname", "contact_name"]);
const FIRST_NAME_KEYS = new Set(["first_name", "firstname", "given_name"]);
const LAST_NAME_KEYS = new Set(["last_name", "lastname", "surname", "family_name"]);
const PHONE_HEADER_KEYS = new Set([
  "phone",
  "phone_number",
  "phonenumber",
  "mobile",
  "mobile_number",
  "tel",
  "telephone",
  "contact_number",
]);

export type MailMergeRow = {
  email: string;
  fields: Record<string, string>;
};

function scanPlaceholders(template: string, found: Set<string>): void {
  for (const re of [DOUBLE_BRACE_RE, SINGLE_BRACE_RE]) {
    const copy = new RegExp(re.source, "g");
    let m: RegExpExecArray | null;
    while ((m = copy.exec(template)) !== null) {
      found.add(normalizeMergeFieldKey(m[1]));
    }
  }
}

export function listPlaceholdersInTemplate(template: string): string[] {
  const found = new Set<string>();
  scanPlaceholders(template, found);
  return Array.from(found);
}

const PLACEHOLDER_ALIASES: Record<string, string[]> = {
  name: ["column_2", "field_2", "full_name", "contact_name"],
  phone: ["column_3", "field_3", "mobile", "contact_number", "tel"],
  company: ["column_4", "field_4", "organisation", "organization"],
};

function lookupField(fields: Record<string, string>, key: string): string {
  const k = normalizeMergeFieldKey(key);
  if (fields[k] !== undefined && fields[k] !== "") return fields[k];

  const lowerMap: Record<string, string> = {};
  for (const [fk, fv] of Object.entries(fields)) {
    if (fv === "") continue;
    lowerMap[normalizeMergeFieldKey(fk)] = fv;
  }
  if (lowerMap[k]) return lowerMap[k];

  for (const alt of PLACEHOLDER_ALIASES[k] || []) {
    if (lowerMap[alt]) return lowerMap[alt];
  }
  return "";
}

/** Fill template with row fields; unknown placeholders stay as-is. */
export function mergeTemplate(template: string, fields: Record<string, string>): string {
  let result = template;
  for (const re of [DOUBLE_BRACE_RE, SINGLE_BRACE_RE]) {
    result = result.replace(re, (match, rawKey: string) => {
      const value = lookupField(fields, rawKey);
      return value !== "" ? value : match;
    });
  }
  return result;
}

function enrichDerivedFields(fields: Record<string, string>): Record<string, string> {
  const out = { ...fields };
  const first = out.first_name?.trim() || "";
  const last = out.last_name?.trim() || "";
  if (!out.name?.trim() && (first || last)) {
    out.name = [first, last].filter(Boolean).join(" ").trim();
  }
  if (!out.first_name?.trim() && out.name?.trim()) {
    const parts = out.name.trim().split(/\s+/);
    if (parts.length === 1) out.first_name = parts[0];
    else if (parts.length > 1) {
      out.first_name = parts[0];
      out.last_name = parts.slice(1).join(" ");
    }
  }
  return out;
}

/** Pick which column holds recipient email (header name or cell content). */
export function resolveEmailColumnIndex(
  headers: string[],
  dataRows: string[][],
  emailFromCell: (cell: string) => string | null
): number {
  for (let i = 0; i < headers.length; i++) {
    const key = normalizeMergeFieldKey(headers[i] || "");
    if (headerLooksLikeEmailColumn(key)) return i;
  }

  let bestIdx = -1;
  let bestHits = 0;
  for (let col = 0; col < headers.length; col++) {
    let hits = 0;
    let total = 0;
    for (const row of dataRows.slice(0, 40)) {
      const v = String(row[col] ?? "").trim();
      if (!v) continue;
      total++;
      if (emailFromCell(v)) hits++;
    }
    if (total > 0 && hits >= Math.max(1, Math.ceil(total * 0.4)) && hits > bestHits) {
      bestHits = hits;
      bestIdx = col;
    }
  }
  return bestIdx;
}

/** Map header row + data row to merge fields (row 1 = headers). */
export function rowToMergeFields(
  headers: string[],
  cells: string[],
  emailColumnIndex: number,
  emailFromCell: (cell: string) => string | null
): Record<string, string> | null {
  const emailRaw = String(cells[emailColumnIndex] ?? "").trim();
  const parsed = emailFromCell(emailRaw);
  if (!parsed) return null;

  const fields: Record<string, string> = { email: parsed };

  for (let i = 0; i < headers.length; i++) {
    if (i === emailColumnIndex) continue;

    const rawHeader = headers[i]?.trim() || `column_${i + 1}`;
    const key = normalizeMergeFieldKey(rawHeader);
    const value = String(cells[i] ?? "").trim();
    if (!value) continue;

    fields[key] = value;
    if (NAME_HEADER_KEYS.has(key)) fields.name = value;
    if (FIRST_NAME_KEYS.has(key)) fields.first_name = value;
    if (LAST_NAME_KEYS.has(key)) fields.last_name = value;
    if (PHONE_HEADER_KEYS.has(key)) fields.phone = value;
  }

  return enrichDerivedFields(fields);
}

export function validateMergeTemplates(
  subjectTemplate: string,
  bodyTemplate: string,
  sampleFields: Record<string, string>
): { ok: true } | { ok: false; missing: string[] } {
  const required = new Set([
    ...listPlaceholdersInTemplate(subjectTemplate),
    ...listPlaceholdersInTemplate(bodyTemplate),
  ]);
  const missing: string[] = [];
  for (const key of Array.from(required)) {
    if (key === "email") continue;
    const v = lookupField(sampleFields, key);
    if (!v.trim()) missing.push(key);
  }
  if (missing.length > 0) return { ok: false, missing };
  return { ok: true };
}
