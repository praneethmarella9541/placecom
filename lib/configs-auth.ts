import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedRequest } from "@/lib/api-auth";
import { isConfigsEmailAllowed, isConfigsEnabled } from "@/lib/configs-access";

export type ConfigsAuthResult =
  | { userId: string; email: string; supabase: SupabaseClient }
  | { error: string; status: 401 | 403 | 404 };

/**
 * Gate for every /api/configs route. Checks the signed-in email against
 * CONFIGS_ALLOWED_EMAILS — role is irrelevant here, being an admin is not
 * enough.
 *
 * Returns 404 rather than 403 when the allowlist is unset, so a deployment that
 * never configured /configs does not advertise that it exists.
 */
export async function assertConfigsAccess(request: Request): Promise<ConfigsAuthResult> {
  if (!isConfigsEnabled()) return { error: "Not found", status: 404 };

  const authed = await getAuthedRequest(request);
  if (!authed) return { error: "Unauthorized", status: 401 };

  const email = authed.user.email ?? "";
  if (!isConfigsEmailAllowed(email)) {
    return { error: "You do not have access to platform configuration.", status: 403 };
  }

  return { userId: authed.user.id, email, supabase: authed.supabase };
}
