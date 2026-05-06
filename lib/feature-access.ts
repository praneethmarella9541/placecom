export const FEATURE_KEYS = [
  "inbox",
  "drive",
  "broadcasting",
  "dashboard",
  "crm",
  "calendar",
  "calls",
  "meetings",
  "sms",
  "whatsapp",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  inbox: "Mail",
  drive: "Drive",
  broadcasting: "Broadcasting",
  dashboard: "Extraction",
  crm: "CRM",
  calendar: "Calendar",
  calls: "Calls",
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
  if (pathname.startsWith("/dashboard")) return "dashboard";
  if (pathname.startsWith("/crm")) return "crm";
  if (pathname.startsWith("/calendar")) return "calendar";
  if (pathname.startsWith("/calls")) return "calls";
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
