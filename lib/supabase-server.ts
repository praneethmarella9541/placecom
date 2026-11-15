import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies } from "next/headers";
import { sessionCookieOptions } from "@/lib/auth-cookies";

export function createServerSupabaseClient() {
  // Next 15 made cookies() async. This factory stays synchronous (it has ~30 callers), so the
  // cookie store is awaited lazily inside the adapter callbacks, which Supabase allows to be async.
  const cookieStorePromise = cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        async getAll() {
          return (await cookieStorePromise).getAll();
        },
        async setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            const cookieStore = await cookieStorePromise;
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, sessionCookieOptions(options))
            );
          } catch {
            // Called from a Server Component — ignore if middleware already refreshed session.
          }
        },
      },
    }
  );
}
