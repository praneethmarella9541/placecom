import { normalizePhone, phoneMatches } from "@/lib/phone";

/** Always listed in Admin → Team (unioned with EXOTEL_VIRTUAL_NUMBERS). */
const BUILTIN_EXOTEL_NUMBERS = ["+91731462415"];

/** Exotel DIDs configured for this deployment (admin assigns one per team member). */
export function listConfiguredExotelNumbers(): string[] {
  const out: string[] = [];
  const multi = process.env.EXOTEL_VIRTUAL_NUMBERS?.trim();
  if (multi) {
    for (const part of multi.split(/[,;\s]+/)) {
      const n = normalizePhone(part.trim());
      if (n && !out.some((existing) => phoneMatches(existing, n))) out.push(n);
    }
  } else {
    const single = process.env.EXOTEL_VIRTUAL_NUMBER?.trim();
    if (single) {
      const n = normalizePhone(single);
      if (n) out.push(n);
    }
  }
  for (const raw of BUILTIN_EXOTEL_NUMBERS) {
    const n = normalizePhone(raw);
    if (n && !out.some((existing) => phoneMatches(existing, n))) out.push(n);
  }
  return out;
}
