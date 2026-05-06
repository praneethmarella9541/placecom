import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { normalizeRestrictedFeatures } from "@/lib/feature-access";

export const runtime = "nodejs";

type PatchBody = {
  userId?: string;
  role?: "staff" | "committee";
  restrictedFeatures?: string[];
};

async function assertAdminUserId() {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) return { error: "Unauthorized", status: 401 as const };
  const { data: me, error: meErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return { error: meErr.message, status: 500 as const };
  if (me?.role !== "admin") return { error: "Admin only", status: 403 as const };
  return { userId: user.id };
}

export async function GET() {
  const auth = await assertAdminUserId();
  if (!("userId" in auth)) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  let { data, error } = await svc
    .from("profiles")
    .select("id, role, display_username, mailbox_owner_id, restricted_features, created_at")
    .eq("mailbox_owner_id", auth.userId)
    .order("created_at", { ascending: true });
  if (error && /restricted_features/i.test(error.message ?? "")) {
    const fallback = await svc
      .from("profiles")
      .select("id, role, display_username, mailbox_owner_id, created_at")
      .eq("mailbox_owner_id", auth.userId)
      .order("created_at", { ascending: true });
    data = fallback.data as typeof data;
    error = fallback.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members = (data ?? []).map((row) => ({
    id: row.id as string,
    role: row.role as string,
    displayUsername: (row.display_username as string | null) ?? null,
    restrictedFeatures: normalizeRestrictedFeatures(row.restricted_features),
  }));

  return NextResponse.json({ members });
}

export async function PATCH(request: Request) {
  const auth = await assertAdminUserId();
  if (!("userId" in auth)) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = body.userId?.trim();
  if (!userId) return NextResponse.json({ error: "userId is required." }, { status: 400 });
  const role = body.role === "committee" ? "committee" : "staff";
  const restrictedFeatures =
    role === "committee" ? normalizeRestrictedFeatures(body.restrictedFeatures) : [];

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  if (role === "committee") {
    const { error: colErr } = await svc
      .from("profiles")
      .select("restricted_features")
      .limit(1);
    if (colErr && /restricted_features/i.test(colErr.message ?? "")) {
      return NextResponse.json(
        { error: "Database migration 0019_committee_feature_access.sql is required for committee access." },
        { status: 503 }
      );
    }
  }

  const { data: existing, error: existsErr } = await svc
    .from("profiles")
    .select("id")
    .eq("id", userId)
    .eq("mailbox_owner_id", auth.userId)
    .maybeSingle();
  if (existsErr) return NextResponse.json({ error: existsErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Team member not found." }, { status: 404 });

  let { error: updErr } = await svc
    .from("profiles")
    .update({
      role,
      restricted_features: restrictedFeatures,
      updated_at: new Date().toISOString(),
    })
    .eq("id", userId)
    .eq("mailbox_owner_id", auth.userId);
  if (updErr && /restricted_features/i.test(updErr.message ?? "")) {
    if (role === "committee") {
      return NextResponse.json(
        { error: "Database migration 0019_committee_feature_access.sql is required for committee access." },
        { status: 503 }
      );
    }
    updErr = (
      await svc
        .from("profiles")
        .update({
          role,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .eq("mailbox_owner_id", auth.userId)
    ).error;
  }
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, userId, role, restrictedFeatures });
}
