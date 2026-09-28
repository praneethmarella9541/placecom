import "server-only";

import { normalizePhone, phoneMatches } from "@/lib/phone";
import { getExotelVirtualNumbers } from "@/lib/exotel-numbers";
import { createServiceSupabase } from "@/lib/supabase-service";

/** Match Exotel `to` field to a full E.164 business line from env + profiles. */
export async function resolveBusinessE164FromWebhook(toRaw: string): Promise<string | null> {
  const trimmed = toRaw.trim();
  if (!trimmed) return null;

  const direct = normalizePhone(trimmed);
  if (direct.startsWith("+")) {
    if (await lineExists(direct)) return direct;
  }

  const candidates = [
    ...(await getExotelVirtualNumbers()),
    ...(await listProfileExotelLines()),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  for (const line of candidates) {
    if (phoneMatches(line, trimmed) || phoneMatches(line, direct)) {
      return line;
    }
  }

  const digits = trimmed.replace(/\D/g, "");
  if (digits.length >= 8) {
    for (const line of candidates) {
      const lineDigits = line.replace(/\D/g, "");
      if (lineDigits.endsWith(digits) || digits.endsWith(lineDigits.slice(-10))) {
        return line;
      }
    }
  }

  return direct.startsWith("+") ? direct : null;
}

async function lineExists(line: string): Promise<boolean> {
  const configured = await getExotelVirtualNumbers();
  if (configured.some((n) => phoneMatches(n, line))) return true;
  const profiles = await listProfileExotelLines();
  return profiles.some((n) => phoneMatches(n, line));
}

async function listProfileExotelLines(): Promise<string[]> {
  try {
    const svc = createServiceSupabase();
    const { data } = await svc
      .from("profiles")
      .select("exotel_virtual_number")
      .not("exotel_virtual_number", "is", null);
    return (data ?? [])
      .map((r) => normalizePhone((r.exotel_virtual_number as string) ?? ""))
      .filter(Boolean);
  } catch {
    return [];
  }
}
