export const FEATURE_KEYS = [
  "inbox",
  "drive",
  "forms",
  "sheets",
  "docs",
  "sequences",
  "dashboard",
  "crm",
  "calendar",
  "sms",
  "contacts",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  inbox: "Mail",
  drive: "Drive",
  forms: "Forms",
  sheets: "Sheets",
  docs: "Docs",
  sequences: "Sequences",
  dashboard: "Extraction",
  crm: "CRM",
  calendar: "Calendar",
  sms: "SMS",
  contacts: "Contacts",
};

/** Features shown in admin access-group checklists. */
export const GROUP_MANAGEABLE_FEATURES: FeatureKey[] = [
  "inbox",
  "drive",
  "forms",
  "sheets",
  "docs",
  "sequences",
  "calendar",
  "crm",
  "sms",
  "contacts",
];

const SET = new Set<string>(FEATURE_KEYS);

/**
 * Returns the set of features allowed on this deployment, or null if no
 * restriction is configured (i.e. NEXT_PUBLIC_ALLOWED_FEATURES is not set).
 * Set NEXT_PUBLIC_ALLOWED_FEATURES=inbox,drive,forms,calendar on subdomain deployments.
 */
export function getAllowedFeatures(): Set<FeatureKey> | null {
  const val = process.env.NEXT_PUBLIC_ALLOWED_FEATURES;
  if (!val?.trim()) return null;
  const keys = val
    .split(",")
    .map((s) => s.trim())
    .filter((s) => SET.has(s)) as FeatureKey[];
  return keys.length ? new Set(keys) : null;
}

export function normalizeRestrictedFeatures(value: unknown): FeatureKey[] {
  if (!Array.isArray(value)) return [];
  const uniq = new Set<FeatureKey>();
  for (const item of value) {
    if (typeof item !== "string") continue;
    if (SET.has(item)) uniq.add(item as FeatureKey);
  }
  return Array.from(uniq);
}

export function pathToFeature(pathname: string): FeatureKey | null {
  if (pathname.startsWith("/inbox")) return "inbox";
  if (pathname.startsWith("/drive")) return "drive";
  if (pathname.startsWith("/forms")) return "forms";
  if (pathname.startsWith("/sheets")) return "sheets";
  if (pathname.startsWith("/docs")) return "docs";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/calendar")) return "calendar";
  if (pathname.startsWith("/sequences")) return "sequences";
  if (pathname.startsWith("/sms")) return "sms";
  if (pathname.startsWith("/contacts")) return "contacts";
  return null;
}

/** Routes under these API prefixes are not tied to a single workspace feature (session, tracking pixels, etc.). */
const API_PUBLIC_PREFIXES = [
  "/api/me/",
  "/api/track/",
  "/api/auth/",
  // Scheduler ticks arrive from an external pinger with no session; they carry
  // their own CRON_SECRET bearer check.
  "/api/cron/",
] as const;

/**
 * Map API pathname to the same {@link FeatureKey} used for pages and admin checks,
 * so committee restrictions apply to data routes — not only UI navigation.
 */
export function apiPathToFeature(pathname: string): FeatureKey | null {
  for (const p of API_PUBLIC_PREFIXES) {
    if (pathname.startsWith(p)) return null;
  }

  if (pathname.startsWith("/api/fetch-emails")) return "dashboard";
  if (pathname.startsWith("/api/gmail")) return "inbox";
  if (pathname.startsWith("/api/mailbox")) return "inbox";

  if (pathname.startsWith("/api/drive")) return "drive";

  if (pathname.startsWith("/api/forms")) return "forms";

  if (pathname.startsWith("/api/sheets")) return "sheets";

  if (pathname.startsWith("/api/docs")) return "docs";

  if (pathname.startsWith("/api/sequences")) return "sequences";

  if (
    pathname.startsWith("/api/extract") ||
    pathname.startsWith("/api/delete-extractions") ||
    pathname.startsWith("/api/export-csv") ||
    pathname.startsWith("/api/jobs") ||
    pathname.startsWith("/api/recruiters")
  ) {
    return "dashboard";
  }

  if (pathname.startsWith("/api/crm")) return "crm";
  if (pathname.startsWith("/api/calendar")) return "calendar";

  if (pathname.startsWith("/api/sms")) return "sms";

  if (pathname.startsWith("/api/broadcast")) {
    if (pathname.includes("/sms")) return "sms";
    // Shared by SMS session import — gated by sign-in only.
    if (pathname.endsWith("/parse-phones")) return null;
    // The spreadsheet parser now serves the inbox's mass sending, not the
    // retired mail channel — gate it with the composer that uses it.
    if (pathname.endsWith("/parse-mail-merge")) return "inbox";
    return null;
  }

  return null;
}

export function requestPathToFeature(pathname: string): FeatureKey | null {
  return pathToFeature(pathname) ?? apiPathToFeature(pathname);
}

/** First workspace URL that is not in the restricted set (same order as main nav). Used when redirecting blocked committee users. */
export function firstAccessibleWorkspacePath(restricted: FeatureKey[]): string {
  const blocked = new Set(restricted);
  const candidates = [
    "/inbox",
    "/drive",
    "/forms",
    "/sheets",
    "/docs",
    "/sequences",
    "/dashboard",
    "/calendar",
    "/contacts",
  ];
  for (const path of candidates) {
    const f = pathToFeature(path);
    if (!f || !blocked.has(f)) return path;
  }
  return "/";
}
