import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const RLS_DELETE_HINT =
  "Row-level security blocked this delete. In Supabase → SQL, run supabase/migrations/0011_meeting_recordings_delete_policy.sql (or confirm the delete policy exists on meeting_recordings).";

export async function DELETE(
  _request: Request,
  context: { params: { id: string } | Promise<{ id: string }> }
) {
  const params =
    context.params instanceof Promise ? await context.params : context.params;
  const id = params.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing meeting id" }, { status: 400 });
  }

  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: existing, error: selectError } = await supabase
    .from("meeting_recordings")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (selectError) {
    console.error("meeting_recordings select before delete:", selectError);
    return NextResponse.json({ error: "Could not load meeting" }, { status: 500 });
  }

  if (!existing) {
    return NextResponse.json({ error: "Meeting not found" }, { status: 404 });
  }

  const { error: deleteError } = await supabase
    .from("meeting_recordings")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteError) {
    console.error("meeting_recordings delete:", deleteError);
    const msg = deleteError.message || "Could not delete meeting";
    const rlsLike =
      /rls|policy|permission denied|42501|insufficient_privilege/i.test(msg) ||
      (deleteError as { code?: string }).code === "42501";
    return NextResponse.json(
      {
        error: msg,
        ...(rlsLike ? { hint: RLS_DELETE_HINT } : {}),
      },
      { status: rlsLike ? 403 : 500 }
    );
  }

  const { data: stillThere } = await supabase
    .from("meeting_recordings")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (stillThere) {
    return NextResponse.json(
      { error: "Delete was blocked (row still exists).", hint: RLS_DELETE_HINT },
      { status: 403 }
    );
  }

  return NextResponse.json({ success: true });
}
