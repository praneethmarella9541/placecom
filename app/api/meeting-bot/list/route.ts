/**
 * List the signed-in user's meeting recordings.
 *
 * The FastAPI service doesn't have a list endpoint (it focuses on the
 * recording flow). We read from Supabase directly here, scoped to the user.
 */

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthedRequest } from "@/lib/api-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const svc = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data, error } = await svc
    .from("meetings")
    .select("meeting_id, meet_link, title, start_time, end_time, status, recorded_url, created_at")
    .eq("user_id", authed.user.id)
    .order("start_time", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ meetings: data ?? [] });
}
