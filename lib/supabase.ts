import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Mark the session cookie Secure when the page itself is served over https.
    { cookieOptions: { secure: typeof window !== "undefined" && window.location.protocol === "https:" } }
  );
}
