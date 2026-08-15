export const FEATURE_KEYS = [
  "inbox",
  "drive",
  "forms",
  "sheets",
  "docs",
  "broadcasting",
  "sequences",
  "dashboard",
  "crm",
  "calendar",
  "meetings",
  "sms",
  "whatsapp",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  inbox: "Mail",
  drive: "Drive",
  forms: "Forms",
  sheets: "Sheets",
  docs: "Docs",
  broadcasting: "Broadcasting",
  sequences: "Sequences",
  dashboard: "Extraction",
  crm: "CRM",
  calendar: "Calendar",
  meetings: "Meetings",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

/** Features shown in admin access-group checklists. */
export const GROUP_MANAGEABLE_FEATURES: FeatureKey[] = [
  "inbox",
  "drive",
  "forms",
  "sheets",
  "docs",
  "broadcasting",
  "sequences",
  "calendar",
  "whatsapp",
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

export function pathToFeature(pathname: string, search: URLSearchParams): FeatureKey | null {
  if (pathname.startsWith("/inbox")) return "inbox";
  if (pathname.startsWith("/drive")) return "drive";
  if (pathname.startsWith("/forms")) return "forms";
  if (pathname.startsWith("/sheets")) return "sheets";
  if (pathname.startsWith("/docs")) return "docs";
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/calendar")) return "calendar";
  if (pathname.startsWith("/meetings")) return "meetings";
  if (pathname.startsWith("/broadcasting")) {
    const channel = search.get("channel");
    if (channel === "sms") return "sms";
    if (channel === "whatsapp") return "whatsapp";
    return "broadcasting";
  }
  if (pathname.startsWith("/sequences")) return "sequences";
  if (pathname.startsWith("/sms")) return "sms";
  if (pathname.startsWith("/whatsapp")) return "whatsapp";
  if (pathname.startsWith("/contacts")) return "whatsapp";
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

  if (pathname.startsWith("/api/meetings")) return "meetings";

  if (pathname.startsWith("/api/sms") || pathname.startsWith("/api/twilio/sms")) return "sms";
  if (pathname.startsWith("/api/whatsapp") || pathname.startsWith("/api/twilio/whatsapp")) return "whatsapp";

  if (pathname.startsWith("/api/broadcast")) {
    if (pathname.includes("/sms")) return "sms";
    if (pathname.includes("/whatsapp") || pathname.endsWith("/parse-wa-merge")) return "whatsapp";
    // Shared by SMS + WhatsApp session import — gated by sign-in only.
    if (pathname.endsWith("/parse-phones")) return null;
    return "broadcasting";
  }

  if (pathname.startsWith("/api/webhooks/fireflies")) return "meetings";

  return null;
}

export function requestPathToFeature(pathname: string, search: URLSearchParams): FeatureKey | null {
  return pathToFeature(pathname, search) ?? apiPathToFeature(pathname);
}

/** First workspace URL that is not in the restricted set (same order as main nav). Used when redirecting blocked committee users. */
export function firstAccessibleWorkspacePath(restricted: FeatureKey[]): string {
  const blocked = new Set(restricted);
  const candidates: { path: string; search?: string }[] = [
    { path: "/inbox" },
    { path: "/drive" },
    { path: "/forms" },
    { path: "/sheets" },
    { path: "/docs" },
    { path: "/broadcasting" },
    { path: "/sequences" },
    { path: "/dashboard" },
    { path: "/calendar" },
    { path: "/whatsapp" },
    { path: "/contacts" },
  ];
  for (const { path, search = "" } of candidates) {
    const sp = new URLSearchParams(search);
    const f = pathToFeature(path, sp);
    if (!f || !blocked.has(f)) return search ? `${path}?${search}` : path;
  }
  return "/";
}
