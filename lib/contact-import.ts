/**
 * Contact book import (CSV / Excel → directory_contacts): column mapping,
 * per-row cleanup, and duplicate matching. Pure and client-safe — the import
 * dialog runs it for its live preview and /api/directory-contacts/import runs
 * it again as the authority, so both judge every row the same way.
 */

import { extractEmailsFromText, isValidEmail } from "@/lib/broadcast-recipients";
import { isLikelyLinkedInUrl, normalizeLinkedInUrl } from "@/lib/contact-directory";
import { isValidE164, normalizePhone, phoneLookupVariants } from "@/lib/phone";

/** One import request's ceiling — the parse route refuses bigger files outright rather than importing part of one. */
export const MAX_IMPORT_ROWS = 5000;

export const IMPORT_TARGETS = [
  "name",
  "first_name",
  "last_name",
  "email",
  "phone",
  "company",
  "title",
  "linkedin_url",
  "location",
  "tags",
  "notes",
] as const;

export type ImportTarget = (typeof IMPORT_TARGETS)[number];

/** Target per file column, by index; null = column isn't imported. */
export type ColumnMapping = (ImportTarget | null)[];

export const IMPORT_TARGET_LABELS: Record<ImportTarget, string> = {
  name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  title: "Designation",
  linkedin_url: "LinkedIn",
  location: "Location",
  tags: "Tags",
  notes: "Notes",
};

/** Targets several columns may feed (tags are unioned, notes joined); every other target takes one column. */
export const MULTI_COLUMN_TARGETS: ReadonlySet<ImportTarget> = new Set<ImportTarget>(["tags", "notes"]);

export type DuplicateMode = "skip" | "update";

/** A file row after mapping, before validation — every value still raw text. */
export type MappedRow = {
  /** 1-based row number in the file, for "Row 14: …" messages. */
  line: number;
  name: string;
  email: string;
  phone: string;
  company: string;
  title: string;
  linkedin_url: string;
  location: string;
  tags: string;
  notes: string;
};

/** A validated contact ready to write. `name` is null when the file had none — see contactDisplayName. */
export type ImportedContact = {
  line: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  linkedin_url: string | null;
  location: string | null;
  tags: string[];
  notes: string | null;
};

export type NormalizedRow =
  | { ok: true; contact: ImportedContact; warnings: string[] }
  | { ok: false; line: number; reason: string };

/** Fields an existing directory contact needs for matching and merging. */
export type ExistingContact = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  company: string | null;
  title: string | null;
  linkedin_url: string | null;
  location: string | null;
  tags: string[] | null;
  notes: string | null;
};

export type RowProblem = { line: number; reason: string };

/** What POST /api/directory-contacts/import reports back. */
export type ContactImportResult = {
  created: number;
  updated: number;
  /** Matched in update mode, but the file had nothing new for them. */
  unchanged: number;
  skippedExisting: number;
  mergedInFile: number;
  /** Rows with no name, email or phone. */
  invalid: RowProblem[];
  /** Rows the database refused. */
  failed: RowProblem[];
};

export type ContactPatch = Partial<Omit<ExistingContact, "id">>;

export type ImportPlan<T extends ExistingContact> = {
  creates: ImportedContact[];
  updates: { existing: T; patch: ContactPatch; lines: number[] }[];
  /** Matched an existing contact and left it alone (skip mode). */
  skippedExisting: number;
  /** Matched an existing contact that the file adds nothing to (update mode). */
  unchanged: number;
  /** Rows folded into an earlier row of the same file. */
  mergedInFile: number;
};

// ---------------------------------------------------------------------------
// Column detection
// ---------------------------------------------------------------------------

function headerKey(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Header spellings per target, most specific first — when two columns claim
 * the same target the earlier alias wins, so Outlook's "Job Title" beats its
 * salutation column "Title". Covers Google Contacts ("E-mail 1 - Value",
 * "Organization Name"), Outlook ("E-mail Address", "Mobile Phone") and
 * LinkedIn connections ("Position"; its "URL" column is caught by content).
 */
const HEADER_ALIASES: Record<ImportTarget, string[]> = {
  name: ["fullname", "name", "contactname", "displayname", "candidatename", "clientname", "personname"],
  first_name: ["firstname", "givenname", "fname", "first"],
  last_name: ["lastname", "surname", "familyname", "lname", "last"],
  email: [
    "email",
    "emailaddress",
    "emailid",
    "email1value",
    "workemail",
    "primaryemail",
    "businessemail",
    "personalemail",
    "mail",
    "mailid",
    "email1",
  ],
  phone: [
    "phone",
    "phonenumber",
    "mobile",
    "mobilenumber",
    "mobileno",
    "mobilephone",
    "phoneno",
    "phone1value",
    "contactnumber",
    "contactno",
    "whatsapp",
    "whatsappnumber",
    "cell",
    "cellphone",
    "primaryphone",
    "businessphone",
    "workphone",
    "homephone",
    "telephone",
    "tel",
  ],
  company: [
    "company",
    "companyname",
    "organization",
    "organisation",
    "organizationname",
    "organisationname",
    "organization1name",
    "employer",
    "currentcompany",
    "accountname",
    "org",
    "firm",
  ],
  title: [
    "jobtitle",
    "designation",
    "position",
    "organizationtitle",
    "organization1title",
    "currentposition",
    "role",
    "title",
  ],
  linkedin_url: ["linkedin", "linkedinurl", "linkedinprofile", "linkedinprofileurl", "linkedinlink"],
  location: ["location", "city", "address", "homeaddress", "businessaddress", "region", "country"],
  tags: ["tags", "tag", "labels", "label", "groupmembership", "groups", "categories", "category", "segment"],
  notes: ["notes", "note", "comments", "comment", "remarks", "description"],
};

/** Salutations that show up in a bare "Title" column (Outlook) — not a designation. */
const SALUTATION_RE = /^(mr|mrs|ms|miss|mx|dr|prof|sir|shri|smt)\.?$/i;

function nonEmptySamples(rows: string[][], col: number, limit = 25): string[] {
  const out: string[] = [];
  for (const row of rows) {
    const v = (row[col] ?? "").trim();
    if (v) out.push(v);
    if (out.length >= limit) break;
  }
  return out;
}

function looksLikePhoneCell(v: string): boolean {
  return /^[+\d\s\-().]+$/.test(v) && isValidE164(v);
}

function looksLikeLinkedInCell(v: string): boolean {
  return /linkedin\.com\//i.test(v);
}

function looksLikePersonName(v: string): boolean {
  if (v.length > 60 || /[@\d]/.test(v)) return false;
  const words = v.trim().split(/\s+/);
  return words.length >= 1 && words.length <= 4 && /^[A-Za-zÀ-ɏ][A-Za-zÀ-ɏ\s'.-]*$/.test(v);
}

/** What a column's cells say it holds, regardless of its header — or null when they don't say clearly. */
function contentTarget(samples: string[]): ImportTarget | null {
  if (samples.length === 0) return null;
  const share = (test: (v: string) => boolean) => samples.filter(test).length / samples.length;
  if (share((v) => extractEmailsFromText(v).length > 0) >= 0.6) return "email";
  if (share(looksLikeLinkedInCell) >= 0.5) return "linkedin_url";
  if (share(looksLikePhoneCell) >= 0.6) return "phone";
  return null;
}

/**
 * Best-guess target per column. Strong content (emails, phone numbers,
 * LinkedIn links) beats the header — Indian sheets often head a phone column
 * "Contact" — and a target taken by one column isn't given to another unless
 * it's a multi-column target.
 */
export function suggestMapping(headers: string[], rows: string[][]): ColumnMapping {
  type Claim = { col: number; target: ImportTarget; rank: number };
  const claims: Claim[] = [];

  headers.forEach((header, col) => {
    const samples = nonEmptySamples(rows, col);
    const fromContent = contentTarget(samples);
    const key = headerKey(header);
    let fromHeader: { target: ImportTarget; rank: number } | null = null;
    for (const target of IMPORT_TARGETS) {
      const rank = HEADER_ALIASES[target].indexOf(key);
      if (rank >= 0) {
        fromHeader = { target, rank };
        break;
      }
    }

    if (fromHeader?.target === "title" && samples.length > 0 && samples.every((s) => SALUTATION_RE.test(s))) {
      fromHeader = null;
    }

    if (fromContent && fromHeader?.target !== fromContent) {
      // Header-matched claims rank ahead of content-only ones (rank 100+).
      claims.push({ col, target: fromContent, rank: fromHeader ? 50 : 100 });
    } else if (fromHeader) {
      claims.push({ col, target: fromHeader.target, rank: fromHeader.rank });
    }
  });

  const mapping: ColumnMapping = headers.map(() => null);
  const taken = new Set<ImportTarget>();
  for (const claim of [...claims].sort((a, b) => a.rank - b.rank || a.col - b.col)) {
    if (taken.has(claim.target) && !MULTI_COLUMN_TARGETS.has(claim.target)) continue;
    mapping[claim.col] = claim.target;
    taken.add(claim.target);
  }

  // A headerless sheet has no "Name" to find — fall back to the leftmost
  // unclaimed column whose cells read like people's names.
  if (!taken.has("name") && !taken.has("first_name") && !taken.has("last_name")) {
    const col = headers.findIndex((_, i) => {
      if (mapping[i] !== null) return false;
      const samples = nonEmptySamples(rows, i);
      return samples.length > 0 && samples.filter(looksLikePersonName).length / samples.length >= 0.6;
    });
    if (col >= 0) mapping[col] = "name";
  }

  return mapping;
}

/** Applying `target` to column `col`, giving it up anywhere else when only one column may hold it. */
export function setColumnTarget(mapping: ColumnMapping, col: number, target: ImportTarget | null): ColumnMapping {
  return mapping.map((t, i) => {
    if (i === col) return target;
    if (target && t === target && !MULTI_COLUMN_TARGETS.has(target)) return null;
    return t;
  });
}

/** Whether a mapping can produce any importable contact at all. */
export function mappingHasIdentity(mapping: ColumnMapping): boolean {
  return mapping.some((t) => t === "name" || t === "first_name" || t === "last_name" || t === "email" || t === "phone");
}

// ---------------------------------------------------------------------------
// Row mapping + validation
// ---------------------------------------------------------------------------

/**
 * Reads file rows through the mapping. `rowNumbers[i]` is rows[i]'s row number
 * in the file, so messages point at the row the user sees in their sheet.
 */
export function mapRows(
  headers: string[],
  rows: string[][],
  rowNumbers: number[],
  mapping: ColumnMapping
): MappedRow[] {
  const notesCols = mapping.filter((t) => t === "notes").length;

  return rows.map((cells, index) => {
    const pick = (target: ImportTarget) =>
      mapping
        .map((t, col) => (t === target ? (cells[col] ?? "").trim() : ""))
        .filter(Boolean);

    const fullName = pick("name")[0] ?? "";
    const splitName = [...pick("first_name"), ...pick("last_name")].join(" ");

    // With more than one notes column, label each part so "Source: Referral"
    // doesn't lose which column it came from.
    const notes = mapping
      .map((t, col) => {
        const v = t === "notes" ? (cells[col] ?? "").trim() : "";
        if (!v) return "";
        return notesCols > 1 ? `${headers[col]}: ${v}` : v;
      })
      .filter(Boolean)
      .join("\n");

    return {
      line: rowNumbers[index] ?? index + 1,
      name: fullName || splitName,
      email: pick("email")[0] ?? "",
      phone: pick("phone")[0] ?? "",
      company: pick("company")[0] ?? "",
      title: pick("title")[0] ?? "",
      linkedin_url: pick("linkedin_url")[0] ?? "",
      location: pick("location")[0] ?? "",
      tags: pick("tags").join(","),
      notes,
    };
  });
}

/**
 * Splits a tags cell. Google Contacts joins labels with " ::: " and adds
 * system groups ("* myContacts", "* starred") that aren't the user's tags.
 */
export function splitTags(raw: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of raw.split(/:::|[,;|]/)) {
    const tag = part.trim();
    if (!tag || tag.startsWith("*")) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function firstPhone(raw: string): string {
  return raw.split(/:::|[,;/]/).map((p) => p.trim()).find(Boolean) ?? "";
}

/**
 * An Indian mobile as +91XXXXXXXXXX, or null. The directory is India-only, so
 * the only accepted shapes are the 10-digit number (first digit 6-9) with an
 * optional 0, 91, +91 or 0091 in front. Anything else — a stray 11th digit,
 * another country code, a landline without its STD code — is rejected rather
 * than guessed at: normalizePhone would turn "98765432101" into +98765432101.
 */
export function normalizeIndianMobile(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  if (!/^\d+$/.test(digits)) return null;
  const m = digits.match(/^(?:0091|091|91|0)?([6-9]\d{9})$/);
  return m ? `+91${m[1]}` : null;
}

function trimmedOrNull(v: string): string | null {
  const t = v.trim();
  return t || null;
}

export function normalizeImportRow(row: MappedRow): NormalizedRow {
  const warnings: string[] = [];

  let email: string | null = null;
  const emailRaw = row.email.trim();
  if (emailRaw) {
    email = isValidEmail(emailRaw) ? emailRaw.toLowerCase() : extractEmailsFromText(emailRaw)[0] ?? null;
    if (!email) warnings.push(`Email "${emailRaw}" isn't valid, left blank`);
  }

  let phone: string | null = null;
  const phoneRaw = firstPhone(row.phone);
  if (phoneRaw) {
    phone = normalizeIndianMobile(phoneRaw);
    if (!phone) warnings.push(`Phone "${phoneRaw}" isn't a valid 10-digit Indian mobile, left blank`);
  }

  let linkedin: string | null = null;
  const linkedinRaw = row.linkedin_url.trim();
  if (linkedinRaw) {
    const normalized = normalizeLinkedInUrl(linkedinRaw);
    if (isLikelyLinkedInUrl(normalized)) linkedin = normalized;
    else warnings.push(`LinkedIn "${linkedinRaw}" isn't a LinkedIn link, left blank`);
  }

  const name = row.name.replace(/\s+/g, " ").trim() || null;
  if (!name && !email && !phone) {
    return { ok: false, line: row.line, reason: "No name, email or phone" };
  }
  if (!name) warnings.push(`No name, saved as ${email ?? phone}`);

  return {
    ok: true,
    warnings,
    contact: {
      line: row.line,
      name,
      email,
      phone,
      company: trimmedOrNull(row.company),
      title: trimmedOrNull(row.title),
      linkedin_url: linkedin,
      location: trimmedOrNull(row.location),
      tags: splitTags(row.tags),
      notes: trimmedOrNull(row.notes),
    },
  };
}

/** The name a contact is saved under — the directory requires one, so a nameless row uses its email or phone. */
export function contactDisplayName(c: ImportedContact): string {
  return c.name ?? c.email ?? c.phone ?? "";
}

/** Appends a batch tag (case-insensitively unique) to a tag list. */
export function withTag(tags: string[], tag: string): string[] {
  const t = tag.trim();
  if (!t || tags.some((x) => x.toLowerCase() === t.toLowerCase())) return tags;
  return [...tags, t];
}

// ---------------------------------------------------------------------------
// Duplicate matching + import plan
// ---------------------------------------------------------------------------

/**
 * Finds the contact a row refers to: same email, or else same phone — but a
 * phone match between two contacts that both have *different* emails is two
 * people sharing a number (an office line), not one person.
 */
class ContactMatcher<T extends { email: string | null; phone: string | null }> {
  private byEmail = new Map<string, T>();
  private byPhone = new Map<string, T[]>();

  add(c: T) {
    if (c.email) {
      const key = c.email.trim().toLowerCase();
      if (!this.byEmail.has(key)) this.byEmail.set(key, c);
    }
    if (c.phone) {
      for (const v of phoneLookupVariants(c.phone)) {
        const list = this.byPhone.get(v) ?? [];
        if (!list.includes(c)) list.push(c);
        this.byPhone.set(v, list);
      }
    }
  }

  find(row: { email: string | null; phone: string | null }): T | undefined {
    const email = row.email?.trim().toLowerCase() || null;
    if (email) {
      const hit = this.byEmail.get(email);
      if (hit) return hit;
    }
    if (!row.phone) return undefined;
    for (const v of phoneLookupVariants(row.phone)) {
      const hit = this.byPhone
        .get(v)
        ?.find((c) => !email || !c.email || c.email.trim().toLowerCase() === email);
      if (hit) return hit;
    }
    return undefined;
  }
}

/**
 * The contact in `existing` that `candidate` refers to, by the same rule the
 * import uses (email, else phone, never two different emails sharing a phone).
 * Used by the add/edit form's duplicate check.
 */
export function findMatchingContact<T extends { email: string | null; phone: string | null }>(
  candidate: { email: string | null; phone: string | null },
  existing: T[]
): T | undefined {
  const matcher = new ContactMatcher<T>();
  for (const c of existing) matcher.add(c);
  return matcher.find(candidate);
}

function appendNotes(existing: string | null, incoming: string | null): string | null {
  if (!incoming) return existing;
  if (!existing) return incoming;
  if (existing.includes(incoming)) return existing;
  return `${existing}\n\n${incoming}`;
}

function unionTags(a: string[], b: string[]): string[] {
  return b.reduce(withTag, a);
}

/** Folds a later duplicate row into an earlier one: the earlier row's values win, gaps get filled. */
function mergeRows(into: ImportedContact, from: ImportedContact): void {
  into.name = into.name ?? from.name;
  into.email = into.email ?? from.email;
  into.phone = into.phone ?? from.phone;
  into.company = into.company ?? from.company;
  into.title = into.title ?? from.title;
  into.linkedin_url = into.linkedin_url ?? from.linkedin_url;
  into.location = into.location ?? from.location;
  into.tags = unionTags(into.tags, from.tags);
  into.notes = appendNotes(into.notes, from.notes);
}

const SCALAR_FIELDS = ["name", "email", "phone", "company", "title", "linkedin_url", "location"] as const;

/** Whether a stored value already says what the file says — hand-typed emails keep their case, phones their spacing. */
function sameValue(field: (typeof SCALAR_FIELDS)[number], stored: string | null, incoming: string): boolean {
  if (!stored) return false;
  if (field === "email") return stored.trim().toLowerCase() === incoming;
  if (field === "phone") return normalizePhone(stored) === incoming;
  return stored === incoming;
}

/**
 * What updating `existing` from a file row changes. A filled cell replaces the
 * stored value, an empty one never clears it; tags are added to, and notes
 * appended to rather than replaced, since both hold hand-written context.
 */
function updatePatch(existing: ExistingContact, row: ImportedContact, batchTag: string): ContactPatch {
  const patch: ContactPatch = {};
  for (const field of SCALAR_FIELDS) {
    const incoming = row[field];
    if (incoming && !sameValue(field, existing[field], incoming)) patch[field] = incoming;
  }
  const currentTags = existing.tags ?? [];
  const tags = withTag(unionTags(currentTags, row.tags), batchTag);
  if (tags.length !== currentTags.length) patch.tags = tags;
  const notes = appendNotes(existing.notes, row.notes);
  if (notes !== existing.notes) patch.notes = notes;
  return patch;
}

/**
 * Decides what an import does: rows duplicated within the file collapse into
 * their first occurrence, then each remaining row either creates a contact or
 * matches an existing one, which is skipped or updated per `mode`.
 */
export function planImport<T extends ExistingContact>(
  rows: ImportedContact[],
  existing: T[],
  mode: DuplicateMode,
  batchTag: string
): ImportPlan<T> {
  const collapsed: ImportedContact[] = [];
  const fileMatcher = new ContactMatcher<ImportedContact>();
  let mergedInFile = 0;
  for (const row of rows) {
    const earlier = fileMatcher.find(row);
    if (earlier) {
      mergeRows(earlier, row);
      fileMatcher.add(earlier);
      mergedInFile++;
    } else {
      const copy = { ...row, tags: [...row.tags] };
      collapsed.push(copy);
      fileMatcher.add(copy);
    }
  }

  const existingMatcher = new ContactMatcher<T>();
  for (const c of existing) existingMatcher.add(c);

  const creates: ImportedContact[] = [];
  const updatesById = new Map<string, { existing: T; patch: ContactPatch; lines: number[] }>();
  let skippedExisting = 0;
  let unchanged = 0;

  for (const row of collapsed) {
    const match = existingMatcher.find(row);
    if (!match) {
      creates.push({ ...row, tags: withTag(row.tags, batchTag) });
      continue;
    }
    if (mode === "skip") {
      skippedExisting++;
      continue;
    }
    // Two file rows can reach the same contact (one by email, one by phone);
    // later ones build on the earlier row's changes instead of overwriting them.
    const pending = updatesById.get(match.id);
    const base: ExistingContact = pending ? { ...match, ...pending.patch } : match;
    const patch = updatePatch(base, row, batchTag);
    if (pending) {
      Object.assign(pending.patch, patch);
      pending.lines.push(row.line);
    } else if (Object.keys(patch).length > 0) {
      updatesById.set(match.id, { existing: match, patch, lines: [row.line] });
    } else {
      unchanged++;
    }
  }

  return {
    creates,
    updates: Array.from(updatesById.values()),
    skippedExisting,
    unchanged,
    mergedInFile,
  };
}
