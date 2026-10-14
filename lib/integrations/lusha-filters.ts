/** The filter choices Find people offers, as Lusha lists them (ids and spellings are Lusha's). */

export const LUSHA_DEPARTMENTS = [
  "Business Development", "Consulting", "Customer Service", "Engineering & Technical", "Finance", "General Management",
  "Health Care & Medical", "Human Resources", "Information Technology", "Legal", "Marketing", "Operations", "Other",
  "Product", "Research & Analytics", "Sales",
];

export const LUSHA_SENIORITY: { id: number; label: string }[] = [
  { id: 10, label: "Founder" },
  { id: 7, label: "Partner" },
  { id: 9, label: "C-suite" },
  { id: 8, label: "Vice president" },
  { id: 6, label: "Director" },
  { id: 5, label: "Manager" },
  { id: 4, label: "Senior" },
  { id: 3, label: "Entry" },
  { id: 2, label: "Intern" },
  { id: 1, label: "Non-manager" },
];

export const LUSHA_DATA_POINTS: { id: string; label: string }[] = [
  { id: "email", label: "Any email" },
  { id: "work_email", label: "Work email" },
  { id: "private_email", label: "Personal email" },
  { id: "phone", label: "Any phone" },
  { id: "mobile_phone", label: "Mobile phone" },
  { id: "direct_phone", label: "Direct phone" },
  { id: "no_dnc_phone", label: "Phone not on a do-not-call list" },
];

export const JOB_CHANGE_OPTIONS: { days: number; label: string }[] = [
  { days: 30, label: "In the last 30 days" },
  { days: 90, label: "In the last 3 months" },
  { days: 180, label: "In the last 6 months" },
  { days: 365, label: "In the last 12 months" },
];

/** One place from Lusha's location lookup: a country, or a city or state inside one. */
export type LushaLocation = { continent?: string; country?: string; state?: string; city?: string };

export function locationLabel(l: LushaLocation): string {
  return [l.city, l.state, l.country ?? l.continent].filter(Boolean).join(", ");
}

export type NumRange = { min?: number; max?: number };

/** Employee-count and revenue bands, exactly as Lusha lists them. */
export const LUSHA_SIZES: NumRange[] = [
  { min: 1, max: 10 }, { min: 11, max: 50 }, { min: 51, max: 200 }, { min: 201, max: 500 }, { min: 501, max: 1000 },
  { min: 1001, max: 5000 }, { min: 5001, max: 10000 }, { min: 10001, max: 100000 }, { min: 100001 },
];

export const LUSHA_REVENUES: NumRange[] = [
  { min: 1, max: 1_000_000 }, { min: 1_000_000, max: 5_000_000 }, { min: 5_000_000, max: 10_000_000 },
  { min: 10_000_000, max: 50_000_000 }, { min: 50_000_000, max: 100_000_000 }, { min: 100_000_000, max: 250_000_000 },
  { min: 250_000_000, max: 500_000_000 }, { min: 500_000_000, max: 1_000_000_000 }, { min: 1_000_000_000, max: 10_000_000_000 },
  { min: 10_000_000_000, max: 100_000_000_000 }, { min: 100_000_000_000 },
];

export const rangeKey = (r: NumRange) => `${r.min ?? ""}-${r.max ?? ""}`;

const money = (n: number) =>
  n >= 1e9 ? `$${n / 1e9}B` : n >= 1e6 ? `$${n / 1e6}M` : n >= 1e3 ? `$${n / 1e3}K` : `$${n}`;

export function sizeLabel(r: NumRange): string {
  return r.max === undefined ? `${(r.min ?? 0).toLocaleString("en-US")}+ employees` : `${r.min} – ${r.max.toLocaleString("en-US")} employees`;
}

export function revenueLabel(r: NumRange): string {
  if (r.max === undefined) return `${money(r.min ?? 0)}+`;
  return `${r.min && r.min > 1 ? money(r.min) : "Under"}${r.min && r.min > 1 ? " – " : " "}${money(r.max)}`;
}

export const LUSHA_BUSINESS_MODELS = ["B2B", "B2C", "B2G"];
export const LUSHA_COMPANY_TYPES = ["Government", "Private Company", "Public Company", "Educational", "Nonprofit"];

export const LUSHA_FUNDING_ROUNDS: { id: string; label: string }[] = [
  { id: "pre_seed", label: "Pre-seed" }, { id: "seed", label: "Seed" }, { id: "series_a", label: "Series A" },
  { id: "series_b", label: "Series B" }, { id: "series_c", label: "Series C" }, { id: "series_d", label: "Series D" },
  { id: "series_e", label: "Series E or later" }, { id: "other", label: "Other" },
];
