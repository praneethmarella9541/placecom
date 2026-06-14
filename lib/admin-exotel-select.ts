import { phoneMatches } from "@/lib/phone";

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
