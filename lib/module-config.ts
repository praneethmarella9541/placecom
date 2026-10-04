import { FEATURE_KEYS, FEATURE_LABELS, type FeatureKey } from "@/lib/feature-access";

/**
 * Platform-level module configuration — the deployment-wide answer to "does
 * this product surface exist at all?", edited from /configs.
 *
 * This sits ABOVE the two older gates and is a hard cap on both:
 *
 *   /configs (here)  →  NEXT_PUBLIC_ALLOWED_FEATURES  →  group restrictions
 *
 * A module switched off here is gone for everyone, admins included: no nav
 * entry, no page, no API route, no prefetch, and no cross-module affordance
 * pointing at it. Admin → Team cannot grant it back, because the checklist
 * only offers modules this config leaves on.
 */

export type ModuleGroupKey = "comms" | "pipeline" | "ops" | "data";

export type ModuleGroup = {
  key: ModuleGroupKey;
  label: string;
  description: string;
  /** Feature keys belonging to this group. Every FEATURE_KEY lives in exactly one group. */
  modules: readonly FeatureKey[];
};

/**
 * Groups mirror the sidebar's own grouping (see `workspaceNavGroups`) so the
 * toggles read the same way the nav does, plus a "data" group for Extraction
 * which has never had a nav entry.
 */
export const MODULE_GROUPS: readonly ModuleGroup[] = [
  {
    key: "comms",
    label: "Comms",
    description:
      "Mail, outbound sequences, campaign reporting, the contact book, SMS, and WhatsApp.",
    modules: ["inbox", "sequences", "campaigns", "contacts", "sms", "whatsapp"],
  },
  {
    key: "pipeline",
    label: "Pipeline",
    description: "Lead stages, interactions, and the CRM board.",
    modules: ["crm"],
  },
  {
    key: "ops",
    label: "Ops",
    description: "Google Workspace surfaces — Drive, Calendar, Forms, Sheets, and Docs.",
    modules: ["drive", "calendar", "forms", "sheets", "docs"],
  },
  {
    key: "data",
    label: "Data",
    description: "AI extraction of recruiters and jobs from mail.",
    modules: ["dashboard"],
  },
] as const;

/** Short per-module blurb for the /configs rows. */
export const MODULE_DESCRIPTIONS: Record<FeatureKey, string> = {
  inbox: "Gmail-backed mail client, composer, and mass send.",
  sequences: "Multi-step automated outbound email with scheduling.",
  campaigns: "Open/click reporting for mail sent from the composer.",
  contacts: "Team directory and synced Google Contacts.",
  sms: "Two-way SMS threads over Exotel.",
  whatsapp:
    "WhatsApp threads, media, templates, and broadcasting over Exotel or Twilio. Also controls the Broadcasting page.",
  crm: "Lead pipeline board with stages and interaction history.",
  drive: "Google Drive browser, sharing, and uploads.",
  calendar: "Google Calendar scheduling, free/busy, and RSVPs.",
  forms: "Form builder and response collection.",
  sheets: "Embedded Google Sheets editor.",
  docs: "Embedded Google Docs editor with link sharing.",
  dashboard: "AI extraction of recruiter and job data from mail.",
};

const GROUP_KEYS = new Set<string>(MODULE_GROUPS.map((g) => g.key));
const FEATURE_SET = new Set<string>(FEATURE_KEYS);

/** Reverse index: feature → the group that owns it. */
export const GROUP_FOR_MODULE: Record<FeatureKey, ModuleGroupKey> = (() => {
  const out = {} as Record<FeatureKey, ModuleGroupKey>;
  for (const group of MODULE_GROUPS) {
    for (const m of group.modules) out[m] = group.key;
  }
  return out;
})();

export type ModuleConfig = {
  disabledGroups: ModuleGroupKey[];
  disabledModules: FeatureKey[];
};

/**
 * Shipping default, and the fallback whenever the config row is missing or
 * unreadable.
 *
 * `sms` and `dashboard` start off because that is what the product looked like
 * before /configs existed: both had working pages, APIs, and feature keys but
 * no sidebar entry, so no user could reach them through the UI. Encoding that
 * here makes the state explicit and reversible instead of hardcoded — flip
 * either one on in /configs to surface it.
 *
 * `whatsapp` starts off because its code was deleted outright in 7db62ea and
 * restored later; nobody had it while it was gone, so turning it on should be a
 * deliberate choice rather than a side effect of deploying the restore.
 *
 * Migration 0066 seeds these same three keys. Keep the two in sync: this
 * default applies only when the config row is missing, the seed applies only
 * when the row is first created, and neither ever overrides a saved config.
 */
export const DEFAULT_MODULE_CONFIG: ModuleConfig = {
  disabledGroups: [],
  disabledModules: ["sms", "dashboard", "whatsapp"],
};

function normalizeList<T extends string>(value: unknown, allowed: Set<string>): T[] {
  if (!Array.isArray(value)) return [];
  const uniq = new Set<T>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    if (allowed.has(item)) uniq.add(item as T);
  }
  return Array.from(uniq);
}

/** Coerce an untrusted payload (DB jsonb, request body) into a valid config. */
export function normalizeModuleConfig(value: unknown): ModuleConfig {
  if (!value || typeof value !== "object") return { disabledGroups: [], disabledModules: [] };
  const raw = value as Record<string, unknown>;
  return {
    disabledGroups: normalizeList<ModuleGroupKey>(raw.disabledGroups, GROUP_KEYS),
    disabledModules: normalizeList<FeatureKey>(raw.disabledModules, FEATURE_SET),
  };
}

export function isGroupEnabled(config: ModuleConfig, group: ModuleGroupKey): boolean {
  return !config.disabledGroups.includes(group);
}

/**
 * A module is live only when its group is on AND its own switch is on, so
 * turning a group off cascades to every child without rewriting their rows.
 *
 * There is deliberately no cross-module dependency cascade. Nothing in the
 * product hard-depends on another module: where one module reaches into
 * another the call is best-effort, and the right answer is to gate that one
 * affordance (see useModuleVisibility call sites), not to switch off a whole
 * module the operator asked for.
 */
export function isModuleEnabled(config: ModuleConfig, feature: FeatureKey): boolean {
  const group = GROUP_FOR_MODULE[feature];
  if (group && !isGroupEnabled(config, group)) return false;
  return !config.disabledModules.includes(feature);
}

/** Every feature this config switches off, group cascade already applied. */
export function disabledFeaturesFromConfig(config: ModuleConfig): FeatureKey[] {
  return (FEATURE_KEYS as readonly FeatureKey[]).filter((f) => !isModuleEnabled(config, f));
}

/** Features this config leaves on — the set Admin → Team may hand out. */
export function enabledFeaturesFromConfig(config: ModuleConfig): FeatureKey[] {
  return (FEATURE_KEYS as readonly FeatureKey[]).filter((f) => isModuleEnabled(config, f));
}

export function moduleLabel(feature: FeatureKey): string {
  return FEATURE_LABELS[feature];
}
