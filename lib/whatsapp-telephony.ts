import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase-service";
import { normalizePhone, phoneMatches } from "@/lib/phone";

export type UserWhatsAppLine = {
  line: string;
  profileId: string;
};

/** Assigned Exotel virtual number used as this user's WhatsApp business line. */
export async function getUserWhatsAppLine(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true; data: UserWhatsAppLine } | { ok: false; error: string; status: number }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("exotel_virtual_number")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    if (/exotel_virtual_number/i.test(error.message ?? "")) {
      return {
        ok: false,
        error: "Database migration 0023_profile_telephony.sql is required.",
        status: 503,
      };
    }
    return { ok: false, error: error.message, status: 500 };
  }

  const line = normalizePhone((data?.exotel_virtual_number as string | null) ?? "");
  if (!line) {
    return {
      ok: false,
      error: "No Exotel/WhatsApp number assigned. Ask your admin to set it under Team.",
      status: 403,
    };
  }

  return { ok: true, data: { line, profileId: userId } };
}

/** Resolve team member who owns this business WhatsApp line (for inbound webhooks). */
export async function findUserIdForBusinessLine(businessE164: string): Promise<string | null> {
  const line = normalizePhone(businessE164);
  if (!line) return null;

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return null;
  }

  const { data, error } = await svc
    .from("profiles")
    .select("id, exotel_virtual_number")
    .not("exotel_virtual_number", "is", null);

  if (error) return null;

  const row = (data ?? []).find(
    (p) => p.exotel_virtual_number && phoneMatches(p.exotel_virtual_number as string, line)
  );
  return row ? (row.id as string) : null;
}
