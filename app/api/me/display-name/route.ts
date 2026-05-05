import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { isMailboxMigrationNotApplied } from "@/lib/supabase-mailbox-migration";

export const runtime = "nodejs";

type Body = { displayUsername?: string };

/** Sets `profiles.display_username` for the signed-in user (shown in the header). */
export async function PATCH(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const raw = body.displayUsername?.trim() ?? "";
  const display_username = raw.slice(0, 64) || null;

  const { error } = await supabase
    .from("profiles")
    .update({ display_username, updated_at: new Date().toISOString() })
    .eq("id", user.id);

  if (error && isMailboxMigrationNotApplied(error)) {
    return NextResponse.json(
      { error: "profiles table not available until migration is applied." },
      { status: 503 }
    );
  }
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, display_username });
}
