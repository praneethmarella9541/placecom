import { phoneMatches } from "@/lib/phone";

/** Configured Exotel lines minus numbers already assigned on any team profile. */
export function filterAvailableExotelNumbers(
  configured: string[],
  assignedGlobally: string[],
  currentMemberExotel?: string | null,
): string[] {
  const current = currentMemberExotel?.trim();
  return configured.filter((num) => {
    if (current && phoneMatches(current, num)) return true;
    return !assignedGlobally.some((assigned) => phoneMatches(assigned, num));
  });
}

/** Dropdown options: unassigned lines plus the member's current line when editing. */
export function exotelNumbersForSelect(
  available: string[],
  current?: string | null,
): string[] {
  const cur = current?.trim();
  if (!cur) return available;
  if (available.some((n) => phoneMatches(n, cur))) return available;
  return [cur, ...available];
}
