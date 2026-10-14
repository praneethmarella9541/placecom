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
