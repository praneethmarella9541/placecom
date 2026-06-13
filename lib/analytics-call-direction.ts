import { deriveCallDirection } from "@/lib/call-status";
import { normalizePhone, phoneMatches } from "@/lib/phone";

export type AnalyticsCallRow = {
  from_number?: string | null;
  to_number?: string | null;
};

/** Same rules as /api/calls GET — per-member virtual line + mobile. */
export function resolveAnalyticsCallDirection(
  row: AnalyticsCallRow,
  userMobile: string,
  userExotel: string,
  allVirtuals: string[]
): "in" | "out" {
  const virtuals = [
    ...allVirtuals,
    ...(userExotel ? [normalizePhone(userExotel)] : []),
  ].filter((v, i, a) => v && a.indexOf(v) === i);

  const fromIsVirtual = virtuals.some((v) => phoneMatches(v, row.from_number ?? ""));
  const toIsUserMobile = userMobile && phoneMatches(userMobile, row.to_number ?? "");
  const fromIsExternal =
    !!row.from_number &&
    !virtuals.some((v) => phoneMatches(v, row.from_number ?? "")) &&
    !(userMobile && phoneMatches(userMobile, row.from_number ?? ""));

  if (fromIsVirtual) return "out";
  if (toIsUserMobile && fromIsExternal) return "in";
  if (fromIsExternal) return "in";

  // Fallback: deriveCallDirection only checks from_number vs virtuals.
  const derived = deriveCallDirection(row.from_number, virtuals, phoneMatches);
  return derived === "outbound" ? "out" : "in";
}
