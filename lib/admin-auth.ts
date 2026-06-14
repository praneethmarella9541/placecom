import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedRequest } from "@/lib/api-auth";

export type AdminAuthResult =
  | { userId: string; email?: string; supabase: SupabaseClient }
  | { error: string; status: 401 | 403 | 500 };

/** Admin check for web (cookie) and mobile (Bearer) requests. */
export async function assertAdminUserId(request: Request): Promise<AdminAuthResult> {
  const authed = await getAuthedRequest(request);
  if (!authed) return { error: "Unauthorized", status: 401 };

  const { data: me, error: meErr } = await authed.supabase
    .from("profiles")
    .select("role")
    .eq("id", authed.user.id)
    .maybeSingle();
  if (meErr) return { error: meErr.message, status: 500 };
  if (me?.role !== "admin") return { error: "Admin only", status: 403 };
  return { userId: authed.user.id, email: authed.user.email, supabase: authed.supabase };
}
