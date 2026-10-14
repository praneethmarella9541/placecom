import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { isLikelyLinkedInUrl, normalizeLinkedInUrl } from "@/lib/contact-directory";
import { findDuplicateContact } from "@/lib/directory-duplicate";
import type { LushaIdentifier, LushaPerson, LushaReveal, LushaUsage } from "@/lib/integrations/lusha";
import { isValidE164, normalizePhone } from "@/lib/phone";

export type EnrichableContact = {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  location: string | null;
};

export type IdentifierBasis = "linkedin" | "email" | "name_company";

/**
 * How to ask Lusha about this contact. LinkedIn is the most exact, an email address next, and name
 * plus company the loosest. Returns why not when the card has too little to go on, so the person is
 * told before anything is spent instead of paying for a miss.
 */
export function identifierFromContact(
  c: EnrichableContact,
): { identifier: LushaIdentifier; basis: IdentifierBasis } | { reason: string } {
  const linkedin = c.linkedin_url?.trim();
  if (linkedin && isLikelyLinkedInUrl(normalizeLinkedInUrl(linkedin))) {
    return { identifier: { linkedinUrl: normalizeLinkedInUrl(linkedin) }, basis: "linkedin" };
  }
  const email = c.email?.trim().toLowerCase();
  if (email && isValidEmail(email)) return { identifier: { email }, basis: "email" };

  const parts = c.name.trim().split(/\s+/).filter(Boolean);
  const company = c.company?.trim();
  if (parts.length >= 2 && company) {
    return {
      identifier: { firstName: parts[0], lastName: parts.slice(1).join(" "), companyName: company },
      basis: "name_company",
    };
  }
  return {
    reason: company
      ? "Add a last name, a LinkedIn link or an email so Lusha can tell who this is."
      : "Add a company, a LinkedIn link or an email so Lusha can tell who this is.",
  };
}

// ─── Cost ────────────────────────────────────────────────────────────────────

const DEFAULT_UNIT = { search: 1, email: 1, phone: 5 };

function unitCost(pricing: LushaUsage["pricing"] | undefined, pattern: RegExp, fallback: number): number {
  for (const [key, v] of Object.entries(pricing ?? {})) {
    if (pattern.test(key) && v.perQuantity > 0) return v.credits / v.perQuantity;
  }
  return fallback;
}

/**
 * The most a reveal for this many people should cost, from the plan's own price list. Lusha only
 * charges for what it finds, so the real figure is often lower — which is why this is shown as
 * "up to" and the actual charge is reported afterwards.
 */
export function estimateCredits(
  pricing: LushaUsage["pricing"] | undefined,
  reveal: LushaReveal[],
  people = 1,
): number {
  let perPerson = unitCost(pricing, /search/i, DEFAULT_UNIT.search);
  if (reveal.includes("emails")) perPerson += unitCost(pricing, /e-?mail/i, DEFAULT_UNIT.email);
  if (reveal.includes("phones")) perPerson += unitCost(pricing, /phone/i, DEFAULT_UNIT.phone);
  return Math.ceil(perPerson * people);
}

/** Cost of revealing fields for people already found by a search, which has already paid for finding them. */
export function estimateRevealOnly(
  pricing: LushaUsage["pricing"] | undefined,
  reveal: LushaReveal[],
  people = 1,
): number {
  let perPerson = 0;
  if (reveal.includes("emails")) perPerson += unitCost(pricing, /e-?mail/i, DEFAULT_UNIT.email);
  if (reveal.includes("phones")) perPerson += unitCost(pricing, /phone/i, DEFAULT_UNIT.phone);
  return Math.ceil(perPerson * people);
}

/** Companies typed as free text: anything that looks like a web address is a domain, the rest are names. */
export function splitCompanies(items: string[]): { names: string[]; domains: string[] } {
  const names: string[] = [];
  const domains: string[] = [];
  for (const raw of items) {
    const t = raw.trim();
    if (!t) continue;
    const bare = t.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
    if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(bare)) domains.push(bare.toLowerCase());
    else names.push(t);
  }
  return { names, domains };
}

// ─── What to write back to the contact ──────────────────────────────────────

export type ProposalField = "email" | "phone" | "title" | "company" | "linkedin_url" | "location";

export type FieldProposal = {
  field: ProposalField;
  label: string;
  current: string | null;
  proposed: string;
  /** "fill" puts a value in an empty field; "replace" would overwrite one that is already there. */
  mode: "fill" | "replace";
  /** Shown beside the value: type, confidence, a do-not-call warning. */
  note: string | null;
};

const CONFIDENCE_RANK: Record<string, number> = { "A+": 6, A: 5, "B+": 4, B: 3, "C+": 2, C: 1 };

function bestEmail(p: LushaPerson) {
  return [...p.emails].sort((a, b) => {
    const work = Number(b.type === "work") - Number(a.type === "work");
    if (work !== 0) return work;
    return (CONFIDENCE_RANK[b.confidence ?? ""] ?? 0) - (CONFIDENCE_RANK[a.confidence ?? ""] ?? 0);
  })[0];
}

function bestPhone(p: LushaPerson) {
  const usable = p.phones.filter((x) => isValidE164(x.number));
  return [...usable].sort((a, b) => {
    const dnc = Number(a.doNotCall) - Number(b.doNotCall);
    if (dnc !== 0) return dnc;
    const rank = (t: string) => (t === "mobile" ? 2 : t === "direct" ? 1 : 0);
    return rank(b.type) - rank(a.type);
  })[0];
}

function differs(a: string | null, b: string): boolean {
  return (a ?? "").trim().toLowerCase() !== b.trim().toLowerCase();
}

/** Turn what Lusha returned into field-by-field suggestions for the contact card. */
export function proposeUpdates(contact: EnrichableContact, person: LushaPerson): FieldProposal[] {
  const out: FieldProposal[] = [];
  const add = (
    field: ProposalField,
    label: string,
    current: string | null,
    proposed: string | null | undefined,
    note: string | null = null,
  ) => {
    const value = proposed?.trim();
    if (!value) return;
    if (current?.trim() && !differs(current, value)) return; // already what the card says
    out.push({ field, label, current: current?.trim() || null, proposed: value, mode: current?.trim() ? "replace" : "fill", note });
  };

  const email = bestEmail(person);
  if (email) {
    add("email", "Email", contact.email, email.email, [email.type, email.confidence ? `confidence ${email.confidence}` : null].filter(Boolean).join(" · "));
  }
  const phone = bestPhone(person);
  if (phone) {
    add("phone", "Phone", contact.phone, normalizePhone(phone.number), [phone.type, phone.doNotCall ? "marked do-not-call" : null].filter(Boolean).join(" · "));
  }
  add("title", "Job title", contact.title, person.title);
  add("company", "Company", contact.company, person.company);
  add("location", "Location", contact.location, person.location);
  add("linkedin_url", "LinkedIn", contact.linkedin_url, person.linkedin ? normalizeLinkedInUrl(person.linkedin) : null);
  return out;
}

/** A contact's fields after filling blanks only — what a bulk run writes without asking. */
export function fillBlanksOnly(proposals: FieldProposal[]): FieldProposal[] {
  return proposals.filter((p) => p.mode === "fill" && !/do-not-call/.test(p.note ?? ""));
}

export type ApplyResult =
  | { ok: true; applied: ProposalField[] }
  | { ok: false; status: number; error: string };

/**
 * Write chosen suggestions to the contact card, with the same checks the card's own edit applies:
 * a valid email or number, a real LinkedIn link, and no duplicate of another contact. `supabase` is
 * the caller's own client, so row-level security keeps the write inside their workspace.
 */
export async function applyProposals(
  supabase: SupabaseClient,
  contactId: string,
  userId: string,
  chosen: { field: ProposalField; value: string }[],
): Promise<ApplyResult> {
  const { data: current } = await supabase
    .from("directory_contacts")
    .select("email, phone, linkedin_url")
    .eq("id", contactId)
    .maybeSingle();
  if (!current) return { ok: false, status: 404, error: "That contact no longer exists." };

  const updates: Record<string, string | null> = {};
  for (const { field, value } of chosen) {
    const v = value.trim();
    if (!v) continue;
    switch (field) {
      case "email":
        if (!isValidEmail(v)) return { ok: false, status: 400, error: "That email address isn't valid." };
        updates.email = v.toLowerCase();
        break;
      case "phone":
        if (!isValidE164(v)) return { ok: false, status: 400, error: "That phone number isn't valid." };
        updates.phone = normalizePhone(v);
        break;
      case "linkedin_url": {
        const url = normalizeLinkedInUrl(v);
        if (!isLikelyLinkedInUrl(url)) return { ok: false, status: 400, error: "That isn't a LinkedIn link." };
        updates.linkedin_url = url;
        break;
      }
      case "title":
      case "company":
      case "location":
        updates[field] = v;
        break;
    }
  }
  if (Object.keys(updates).length === 0) return { ok: true, applied: [] };

  if (updates.email !== undefined || updates.phone !== undefined) {
    const duplicate = await findDuplicateContact(
      supabase,
      {
        email: updates.email !== undefined ? updates.email : (current.email as string | null),
        phone: updates.phone !== undefined ? updates.phone : (current.phone as string | null),
      },
      contactId,
    );
    if (duplicate) {
      return {
        ok: false,
        status: 409,
        error: `${duplicate.name || "Another contact"} already has that email or number in the directory.`,
      };
    }
  }

  const { error } = await supabase
    .from("directory_contacts")
    .update({ ...updates, updated_by: userId, updated_at: new Date().toISOString() })
    .eq("id", contactId);
  if (error) return { ok: false, status: 500, error: error.message };
  return { ok: true, applied: Object.keys(updates) as ProposalField[] };
}

// ─── Planning a bulk run ─────────────────────────────────────────────────────

export type BulkSkip = { id: string; name: string; reason: string };
export type BulkJob = { contact: EnrichableContact; identifier: LushaIdentifier; reveal: LushaReveal[] };
export type BulkPlan = {
  skipped: BulkSkip[];
  /** Contacts whose earlier, already-paid reveal can fill them in for nothing. */
  reuse: { contact: EnrichableContact; person: LushaPerson }[];
  /** Contacts to ask Lusha about, grouped by which fields each is missing (one Lusha call per group). */
  groups: Map<string, BulkJob[]>;
};

/**
 * Decide, before any credit is spent, what a bulk run will do with each contact. Someone who already
 * has what is being asked for is skipped; so is someone Lusha could not identify from their card; a
 * contact revealed earlier is filled in from that stored result instead of being paid for again.
 */
export function planBulk(
  contacts: EnrichableContact[],
  wanted: LushaReveal[],
  prior: Map<string, { person: LushaPerson }>,
): BulkPlan {
  const skipped: BulkSkip[] = [];
  const reuse: BulkPlan["reuse"] = [];
  const groups = new Map<string, BulkJob[]>();

  for (const contact of contacts) {
    const reveal: LushaReveal[] = [];
    if (wanted.includes("emails") && !contact.email) reveal.push("emails");
    if (wanted.includes("phones") && !contact.phone) reveal.push("phones");
    if (reveal.length === 0) {
      skipped.push({ id: contact.id, name: contact.name, reason: "Already has what you asked for" });
      continue;
    }
    const earlier = prior.get(contact.id);
    if (earlier && fillBlanksOnly(proposeUpdates(contact, earlier.person)).length > 0) {
      reuse.push({ contact, person: earlier.person });
      continue;
    }
    const identified = identifierFromContact(contact);
    if ("reason" in identified) {
      skipped.push({ id: contact.id, name: contact.name, reason: identified.reason });
      continue;
    }
    const key = [...reveal].sort().join("+");
    const job: BulkJob = { contact, identifier: { ...identified.identifier, clientReferenceId: contact.id }, reveal };
    groups.set(key, [...(groups.get(key) ?? []), job]);
  }
  return { skipped, reuse, groups };
}

/** Share a batch's total charge across its people so the per-person log adds back up to the total. */
export function splitCredits(total: number, people: number): number[] {
  if (people <= 0) return [];
  const base = Math.floor(total / people);
  let extra = total - base * people;
  return Array.from({ length: people }, () => base + (extra-- > 0 ? 1 : 0));
}
