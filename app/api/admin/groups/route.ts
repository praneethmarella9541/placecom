import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { normalizeRestrictedFeatures, type FeatureKey } from "@/lib/feature-access";

export const runtime = "nodejs";

type GroupBody = {
  name?: string;
  restrictedFeatures?: string[];
};

async function assertAdminUserId(): Promise<
  { userId: string } | { error: string; status: 401 | 403 | 500 }
> {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) return { error: "Unauthorized", status: 401 };

  const { data: me, error: meErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();
  if (meErr) return { error: meErr.message, status: 500 };
  if (me?.role !== "admin") return { error: "Admin only", status: 403 };
  return { userId: user.id };
}

function mapGroup(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    name: row.name as string,
    restrictedFeatures: normalizeRestrictedFeatures(row.restricted_features),
    createdAt: row.created_at as string,
  };
}

/** GET /api/admin/groups — list custom groups for this admin's team */
export async function GET() {
  const auth = await assertAdminUserId();
  if (!("userId" in auth)) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { data, error } = await svc
    .from("team_groups")
    .select("id, name, restricted_features, created_at")
    .eq("mailbox_owner_id", auth.userId)
    .order("name", { ascending: true });

  if (error) {
    if (/team_groups/i.test(error.message ?? "")) {
      return NextResponse.json({ groups: [] });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ groups: (data ?? []).map(mapGroup) });
}

/** POST /api/admin/groups — create a custom group */
export async function POST(request: Request) {
  const auth = await assertAdminUserId();
  if (!("userId" in auth)) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: GroupBody;
  try {
    body = (await request.json()) as GroupBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const name = body.name?.trim() ?? "";
  if (!name || name.length > 64) {
    return NextResponse.json({ error: "Group name is required (max 64 characters)." }, { status: 400 });
  }

  const restrictedFeatures = normalizeRestrictedFeatures(body.restrictedFeatures);

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { data, error } = await svc
    .from("team_groups")
    .insert({
      mailbox_owner_id: auth.userId,
      name,
      restricted_features: restrictedFeatures,
    })
    .select("id, name, restricted_features, created_at")
    .single();

  if (error) {
    if (/unique/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "A group with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, group: mapGroup(data as Record<string, unknown>) });
}

/** PATCH /api/admin/groups — update group name or blocked features */
export async function PATCH(request: Request) {
  const auth = await assertAdminUserId();
  if (!("userId" in auth)) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: GroupBody & { groupId?: string };
  try {
    body = (await request.json()) as GroupBody & { groupId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const groupId = body.groupId?.trim();
  if (!groupId) return NextResponse.json({ error: "groupId is required." }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.name !== undefined) {
    const name = body.name.trim();
    if (!name || name.length > 64) {
      return NextResponse.json({ error: "Group name is required (max 64 characters)." }, { status: 400 });
    }
    patch.name = name;
  }
  if (body.restrictedFeatures !== undefined) {
    patch.restricted_features = normalizeRestrictedFeatures(body.restrictedFeatures);
  }

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { data, error } = await svc
    .from("team_groups")
    .update(patch)
    .eq("id", groupId)
    .eq("mailbox_owner_id", auth.userId)
    .select("id, name, restricted_features, created_at")
    .maybeSingle();

  if (error) {
    if (/unique/i.test(error.message ?? "")) {
      return NextResponse.json({ error: "A group with this name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) return NextResponse.json({ error: "Group not found." }, { status: 404 });

  return NextResponse.json({ ok: true, group: mapGroup(data as Record<string, unknown>) });
}

/** DELETE /api/admin/groups — remove group (members keep profile, group_id cleared via FK) */
export async function DELETE(request: Request) {
  const auth = await assertAdminUserId();
  if (!("userId" in auth)) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { groupId?: string };
  try {
    body = (await request.json()) as { groupId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const groupId = body.groupId?.trim();
  if (!groupId) return NextResponse.json({ error: "groupId is required." }, { status: 400 });

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { error } = await svc
    .from("team_groups")
    .delete()
    .eq("id", groupId)
    .eq("mailbox_owner_id", auth.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export type { FeatureKey };
