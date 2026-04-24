import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export async function POST() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error: e1 } = await supabase
    .from("email_extractions")
    .delete()
    .eq("user_id", user.id);

  if (e1) {
    console.error(e1);
    return NextResponse.json({ error: e1.message }, { status: 500 });
  }

  const { error: e2 } = await supabase
    .from("extraction_jobs")
    .delete()
    .eq("user_id", user.id);

  if (e2) {
    console.error(e2);
    return NextResponse.json({ error: e2.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
