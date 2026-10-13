import "server-only";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { cookies, type UnsafeUnwrappedCookies } from "next/headers";

export function createServerSupabaseClient() {
  // Next 15 made cookies() async. This factory is synchronous and called from ~30 places, so it
  // uses the sync-compatibility cast Next still supports in 15 (removed in 16 — make this
  // function async and await it at the call sites before upgrading to 16).
  const cookieStore = cookies() as unknown as UnsafeUnwrappedCookies;

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                secure: process.env.NODE_ENV === "production",
              })
            );
          } catch {
            // Called from a Server Component — ignore if middleware already refreshed session.
          }
        },
      },
    }
  );
}
