import "server-only";

import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase-server";

/** Dedupes `getUser()` within the same RSC request when multiple server components need the session. */
export const getCachedAuthUser = cache(async () => {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
