/** Helpers for enriching an uploaded list: which column is which, and writing the result back out as CSV. */

export type CsvRole = "name" | "firstName" | "lastName" | "company" | "email" | "phone" | "linkedin";

export const CSV_ROLES: { role: CsvRole; label: string }[] = [
  { role: "name", label: "Full name" },
  { role: "firstName", label: "First name" },
  { role: "lastName", label: "Last name" },
  { role: "company", label: "Company" },
  { role: "email", label: "Email (if you have one)" },
  { role: "phone", label: "Phone (if you have one)" },
  { role: "linkedin", label: "LinkedIn link" },
];

const PATTERNS: Record<CsvRole, RegExp> = {
  linkedin: /linked.?in/i,
  email: /e-?mail/i,
  phone: /phone|mobile|cell|tel\b/i,
  firstName: /^(first|given)[\s_-]*name$|^first$|^fname$/i,
  lastName: /^(last|sur|family)[\s_-]*name$|^last$|^lname$/i,
  name: /^(full[\s_-]*)?name$|^contact$|^person$/i,
  company: /company|organi[sz]ation|employer|account|^org$/i,
};

/** Best guess at which column holds what, by header name. Returns the column index for each role, or -1. */
export function guessColumns(headers: string[]): Record<CsvRole, number> {
  const out = { name: -1, firstName: -1, lastName: -1, company: -1, email: -1, phone: -1, linkedin: -1 } as Record<CsvRole, number>;
  const used = new Set<number>();
  for (const role of ["linkedin", "email", "phone", "firstName", "lastName", "name", "company"] as CsvRole[]) {
    const i = headers.findIndex((h, idx) => !used.has(idx) && PATTERNS[role].test(h.trim()));
    if (i >= 0) {
      out[role] = i;
      used.add(i);
    }
  }
  return out;
}

/** A cell that a spreadsheet would run as a formula is stored as text instead. */
function cell(v: string): string {
  // Phone numbers like "+91 98765 43210" are plain text to a spreadsheet; anything else starting with a formula character is quoted as text.
  const safe = /^[=+\-@\t\r]/.test(v) && !/^\+?[\d\s().-]+$/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** CSV text with a byte-order mark, so Excel reads accents correctly. */
export function toCsv(headers: string[], rows: string[][]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")}\r\n`;
}
