/** UI presets mapped to Google Calendar RRULE strings. */
export type RecurrencePreset =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "biweekly"
  | "monthly";

export const RECURRENCE_OPTIONS: { value: RecurrencePreset; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Daily" },
  { value: "weekdays", label: "Every weekday (Mon–Fri)" },
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Monthly" },
];

export function buildRecurrenceRules(preset: RecurrencePreset): string[] | undefined {
  switch (preset) {
    case "daily":
      return ["RRULE:FREQ=DAILY"];
    case "weekdays":
      return ["RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"];
    case "weekly":
      return ["RRULE:FREQ=WEEKLY"];
    case "biweekly":
      return ["RRULE:FREQ=WEEKLY;INTERVAL=2"];
    case "monthly":
      return ["RRULE:FREQ=MONTHLY"];
    default:
      return undefined;
  }
}

export function parseRecurrencePreset(recurrence?: string[] | null): RecurrencePreset {
  if (!recurrence?.length) return "none";
  const rrule = recurrence.find((r) => r.startsWith("RRULE:")) ?? "";
  if (rrule.includes("BYDAY=MO,TU,WE,TH,FR")) return "weekdays";
  if (rrule.includes("INTERVAL=2") && rrule.includes("FREQ=WEEKLY")) return "biweekly";
  if (rrule.includes("FREQ=DAILY")) return "daily";
  if (rrule.includes("FREQ=MONTHLY")) return "monthly";
  if (rrule.includes("FREQ=WEEKLY")) return "weekly";
  return "weekly";
}

export function formatRecurrenceLabel(recurrence?: string[] | null): string | null {
  const preset = parseRecurrencePreset(recurrence);
  if (preset === "none") return null;
  return RECURRENCE_OPTIONS.find((o) => o.value === preset)?.label ?? "Repeats";
}
