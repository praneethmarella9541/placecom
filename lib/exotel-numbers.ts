import { normalizePhone } from "@/lib/phone";

/** Exotel DIDs configured for this deployment (admin assigns one per team member). */
export function listConfiguredExotelNumbers(): string[] {
  const multi = process.env.EXOTEL_VIRTUAL_NUMBERS?.trim();
  if (multi) {
    return multi
      .split(/[,;\s]+/)
      .map((s) => normalizePhone(s.trim()))
      .filter(Boolean);
  }
  const single = process.env.EXOTEL_VIRTUAL_NUMBER?.trim();
  return single ? [normalizePhone(single)] : [];
}
