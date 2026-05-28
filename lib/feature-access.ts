export const FEATURE_KEYS = [
  "inbox",
  "drive",
  "sheets",
  "forms",
  "broadcasting",
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
  sheets: "Sheets",
  forms: "Forms",
  broadcasting: "Broadcasting",
  dashboard: "Extraction",
  crm: "CRM",
  calendar: "Calendar",
  meetings: "Meetings",
  sms: "SMS",
  whatsapp: "WhatsApp",
};

const SET = new Set<string>(FEATURE_KEYS);

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
  if (pathname.startsWith("/sheets")) return "sheets";
  if (pathname.startsWith("/forms")) return "forms";
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
  if (pathname.startsWith("/sms")) return "sms";
  if (pathname.startsWith("/whatsapp")) return "whatsapp";
  return null;
}

/** Routes under these API prefixes are not tied to a single workspace feature (session, tracking pixels, etc.). */
const API_PUBLIC_PREFIXES = [
  "/api/me/",
  "/api/track/",
  "/api/auth/",
] as const;

/**
 * Map API pathname to the same {@link FeatureKey} used for pages and admin checks,
 * so committee restrictions apply to data routes — not only UI navigation.
 */
export function apiPathToFeature(pathname: string): FeatureKey | null {
  for (const p of API_PUBLIC_PREFIXES) {
    if (pathname.startsWith(p)) return null;
  }

  if (pathname.startsWith("/api/gmail") || pathname.startsWith("/api/fetch-emails")) return "inbox";
  if (pathname.startsWith("/api/mailbox")) return "inbox";

  if (pathname.startsWith("/api/drive")) return "drive";

  if (pathname.startsWith("/api/sheets")) return "sheets";

  if (pathname.startsWith("/api/forms")) return "forms";

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
    if (pathname.includes("/whatsapp")) return "whatsapp";
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
    { path: "/sheets" },
    { path: "/forms" },
    { path: "/broadcasting" },
    { path: "/dashboard" },
    { path: "/crm" },
    { path: "/calendar" },
    { path: "/sms" },
    { path: "/whatsapp" },
    { path: "/meetings" },
  ];
  for (const { path, search = "" } of candidates) {
    const sp = new URLSearchParams(search);
    const f = pathToFeature(path, sp);
    if (!f || !blocked.has(f)) return search ? `${path}?${search}` : path;
  }
  return "/";
}
