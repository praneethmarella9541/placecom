import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export type AuthedUser = { id: string; email?: string; app_metadata?: { provider?: string } };
export type AuthedRequest = {
  user: AuthedUser;
  supabase: SupabaseClient;
  /** True when the request is from the mobile app (Bearer token). */
  isBearer: boolean;
};

/**
 * Resolves the signed-in user from either:
 *  - a Supabase session cookie (web app), or
 *  - an Authorization: Bearer <jwt> header (mobile app).
 *
 * Returns a Supabase client whose RLS context is the same user.
 */
export async function getAuthedRequest(request: Request): Promise<AuthedRequest | null> {
  const authHeader = request.headers.get("Authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const anon = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );
    const { data: { user }, error } = await anon.auth.getUser(token);
    if (!error && user) {
      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        { global: { headers: { Authorization: `Bearer ${token}` } } }
      );
      return {
        user: { id: user.id, email: user.email, app_metadata: user.app_metadata },
        supabase,
        isBearer: true,
      };
    }
    console.error("[api-auth] Bearer token rejected:", error?.message);
  }

  const supabase = createServerSupabaseClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return null;
  return {
    user: { id: user.id, email: user.email, app_metadata: user.app_metadata },
    // Cast to the broader SupabaseClient type — server client is API-compatible
    supabase: supabase as unknown as SupabaseClient,
    isBearer: false,
  };
}
