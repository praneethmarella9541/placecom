/**
 * Mail-merge placeholders: {{field_name}} or {field_name}
 * Field names are case-insensitive; use underscores in templates (e.g. {{first_name}}).
 */

const PLACEHOLDER_RE = /\{\{?\s*([a-zA-Z0-9_]+)\s*\}?\}/g;

/** Normalize spreadsheet header → merge key (e.g. "First Name" → first_name). */
export function normalizeMergeFieldKey(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const EMAIL_HEADER_KEYS = new Set(["email", "e_mail", "mail", "email_address"]);
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

export function listPlaceholdersInTemplate(template: string): string[] {
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  const re = new RegExp(PLACEHOLDER_RE.source, "g");
  while ((m = re.exec(template)) !== null) {
    found.add(normalizeMergeFieldKey(m[1]));
  }
  return Array.from(found);
}

function lookupField(fields: Record<string, string>, key: string): string {
  const k = normalizeMergeFieldKey(key);
  if (fields[k] !== undefined) return fields[k];

  const lowerMap: Record<string, string> = {};
  for (const [fk, fv] of Object.entries(fields)) {
    lowerMap[normalizeMergeFieldKey(fk)] = fv;
  }
  return lowerMap[k] ?? "";
}

/** Fill template with row fields; unknown placeholders stay as-is. */
export function mergeTemplate(template: string, fields: Record<string, string>): string {
  return template.replace(PLACEHOLDER_RE, (match, rawKey: string) => {
    const value = lookupField(fields, rawKey);
    return value !== "" ? value : match;
  });
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

/** Map header row + data row to merge fields with standard aliases. */
export function rowToMergeFields(
  headers: string[],
  cells: string[]
): Record<string, string> | null {
  const fields: Record<string, string> = {};
  let email = "";

  for (let i = 0; i < headers.length; i++) {
    const rawHeader = headers[i]?.trim() || `column_${i + 1}`;
    const key = normalizeMergeFieldKey(rawHeader);
    const value = String(cells[i] ?? "").trim();
    if (!value) continue;

    if (EMAIL_HEADER_KEYS.has(key) || (key.includes("email") && !email)) {
      email = value.toLowerCase();
      fields.email = email;
      continue;
    }
    if (NAME_HEADER_KEYS.has(key)) fields.name = value;
    else if (FIRST_NAME_KEYS.has(key)) fields.first_name = value;
    else if (LAST_NAME_KEYS.has(key)) fields.last_name = value;
    else if (PHONE_HEADER_KEYS.has(key)) fields.phone = value;
    else fields[key] = value;
  }

  if (!email && fields.email) email = fields.email;
  if (!email) return null;

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
