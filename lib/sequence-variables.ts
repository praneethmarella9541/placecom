/**
 * Merge variables for sequence steps, and the contact data that fills them.
 *
 * Built on top of lib/compose-variables so a sequence email offers the same
 * variables mass-send compose does, resolved from the same two sources (Team
 * Directory card first, mailbox-synced contact for whatever the card left
 * blank). Before this, a sequence enrollment only ever stored name/company, so
 * a step that used {job_title} had nothing to merge — and an unfillable
 * placeholder is not cosmetic here: sequence-runner skips that recipient and
 * flags them "needs attention" rather than sending a half-merged email.
 */

import {
  COMPOSE_VARIABLES,
  MERGE_FIELD_ALIAS_KEYS,
  contactToMergeFields,
  mergeFieldSources,
  syncedContactToMergeFields,
  type ComposeVariable,
} from "@/lib/compose-variables";
import { normalizeMergeFieldKey } from "@/lib/mail-merge";

/**
 * Sequence-only variables. Compose has no equivalent: it addresses one person
 * per send and greets them by full name, whereas a sequence's first line is
 * almost always "Hi {first_name}". Both are derived from the resolved name
 * rather than stored by any contact source.
 */
const NAME_PART_VARIABLES: ComposeVariable[] = [
  { key: "first_name", label: "First name", hint: "First word of the contact's name" },
  { key: "last_name", label: "Last name", hint: "Everything after the first word" },
];

const EMAIL_VARIABLE: ComposeVariable = {
  key: "email",
  label: "Email",
  hint: "The address this sequence is sent to",
};

/** Offered by the `{` picker in every sequence step. */
export const SEQUENCE_VARIABLES: ComposeVariable[] = [
  ...NAME_PART_VARIABLES,
  ...COMPOSE_VARIABLES,
  EMAIL_VARIABLE,
];

const KNOWN_KEYS = new Set<string>([
  ...SEQUENCE_VARIABLES.map((v) => v.key),
  ...MERGE_FIELD_ALIAS_KEYS,
]);

/** The columns buildEnrollmentMergeFields needs off a directory_contacts row. */
export type DirectoryCardFields = {
  name: string | null;
  company: string | null;
  title: string | null;
  phone: string | null;
  email: string | null;
};

/** The columns it needs off a synced_contacts row. */
export type SyncedContactFields = {
  email: string;
  display_name: string | null;
  company_name: string | null;
  last_interaction_at: string | null;
};

export type EnrollmentFieldSources = {
  directory?: DirectoryCardFields | null;
  synced?: SyncedContactFields | null;
  /** Name carried by the recipient chip the user picked. */
  displayName?: string | null;
  /** Explicit fields from an API caller — outrank everything derived. */
  custom?: Record<string, string> | null;
  /** Fields already stored on the enrollment — weakest, so a refresh can keep
   *  hand-set or API-set keys that no contact source produces. */
  existing?: Record<string, string> | null;
};

function normalizeBag(bag: Record<string, string> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(bag ?? {})) {
    if (typeof value === "string" && value.trim()) out[normalizeMergeFieldKey(key)] = value.trim();
  }
  return out;
}

/**
 * The merge-field bag stored on a sequence enrollment.
 *
 * Source order mirrors compose's (see the massMergeRows memo in the inbox
 * page): the Team Directory card wins field by field, the mailbox sync fills
 * its gaps, and the picked chip's display name is the last resort for a name.
 * Only non-empty values are kept — mergeFieldSources drops blanks — so a key
 * being present always means it has something to merge.
 */
export function buildEnrollmentMergeFields(
  email: string,
  sources: EnrollmentFieldSources
): Record<string, string> {
  const { directory, synced, displayName, custom, existing } = sources;

  const fields = mergeFieldSources(
    normalizeBag(custom),
    directory
      ? contactToMergeFields({
          name: directory.name ?? "",
          company: directory.company,
          title: directory.title,
          phone: directory.phone,
          email: directory.email,
        })
      : undefined,
    synced ? syncedContactToMergeFields(synced) : undefined,
    displayName?.trim() ? { name: displayName.trim() } : undefined,
    normalizeBag(existing)
  );

  // Always the address actually enrolled, never the card's — a card filed
  // under a second address must not redirect {email} away from this row.
  fields.email = email.trim().toLowerCase();

  const [first, ...rest] = (fields.name ?? "").split(/\s+/).filter(Boolean);
  if (first && !fields.first_name) fields.first_name = first;
  if (rest.length && !fields.last_name) fields.last_name = rest.join(" ");

  return fields;
}

/**
 * Variables to offer for a given set of enrolled recipients: the standard list,
 * plus any extra key their stored fields actually carry.
 *
 * The extras are the sequence's answer to compose's imported-column variables —
 * fields set through the enrollments API rather than a spreadsheet, but the
 * same idea: if the data is there, it should be offerable.
 */
export function variablesForEnrollments(
  fieldSets: Array<Record<string, string>>
): ComposeVariable[] {
  const extras = new Map<string, ComposeVariable>();
  for (const set of fieldSets) {
    for (const [key, value] of Object.entries(set)) {
      if (KNOWN_KEYS.has(key) || extras.has(key) || !value?.trim()) continue;
      extras.set(key, {
        key,
        label: key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()),
        hint: "Set on the recipient by the enrollments API",
      });
    }
  }
  return [...SEQUENCE_VARIABLES, ...Array.from(extras.values())];
}

/**
 * How many of these recipients have a value for each variable.
 *
 * Drives the coverage note under each step: a variable no one can fill is the
 * one thing worth flagging before sending, since every recipient missing it
 * gets skipped at send time.
 */
export function mergeFieldCoverage(
  fieldSets: Array<Record<string, string>>,
  variables: ComposeVariable[]
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const v of variables) {
    counts[v.key] = fieldSets.filter((set) => set[v.key]?.trim()).length;
  }
  return counts;
}
