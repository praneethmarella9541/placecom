import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { normalizeRestrictedFeatures } from "@/lib/feature-access";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";
import { isValidE164, normalizePhone, phoneMatches } from "@/lib/phone";

export const runtime = "nodejs";
const MIN_PASSWORD_LEN = 8;

type PatchBody = {
  userId?: string;
  email?: string;
  password?: string;
  role?: "staff" | "committee";
  restrictedFeatures?: string[];
  mobilePhone?: string | null;
  exotelVirtualNumber?: string | null;
};

function normalizeOptionalPhone(
  value: string | null | undefined,
  fieldLabel: string
): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (value === undefined) return { ok: true, value: undefined };
  if (value === null || value === "") return { ok: true, value: null };
  const normalized = normalizePhone(String(value).trim());
  if (!isValidE164(normalized)) {
    return {
      ok: false,
      error: `${fieldLabel} must include country code, e.g. +919876543210.`,
    };
  }
  return { ok: true, value: normalized };
}

async function assertExotelNotTaken(
  svc: ReturnType<typeof createServiceSupabase>,
  adminId: string,
  exotel: string | null,
  excludeUserId: string
): Promise<string | null> {
  if (!exotel) return null;
  const configured = listConfiguredExotelNumbers();
  if (configured.length > 0 && !configured.some((n) => phoneMatches(n, exotel))) {
    return "That Exotel number is not configured on the server. Add it to EXOTEL_VIRTUAL_NUMBERS.";
  }
  const { data: peers, error } = await svc
    .from("profiles")
    .select("id, exotel_virtual_number")
    .eq("mailbox_owner_id", adminId)
    .not("exotel_virtual_number", "is", null);
  if (error) {
    if (/exotel_virtual_number/i.test(error.message ?? "")) {
      return "Database migration 0023_profile_telephony.sql is required.";
    }
    return error.message;
  }
  const taken = (peers ?? []).find(
    (p) =>
      (p.id as string) !== excludeUserId &&
      p.exotel_virtual_number &&
      phoneMatches(p.exotel_virtual_number as string, exotel)
  );
  if (taken) return "That Exotel number is already assigned to another team member.";
  return null;
}

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
    .select(
      "id, role, display_username, mailbox_owner_id, restricted_features, mobile_phone, exotel_virtual_number, created_at"
    )
    .eq("mailbox_owner_id", auth.userId)
    .order("created_at", { ascending: true });
  if (error && /restricted_features|mobile_phone|exotel_virtual_number/i.test(error.message ?? "")) {
    const fallback = await svc
      .from("profiles")
      .select("id, role, display_username, mailbox_owner_id, created_at")
      .eq("mailbox_owner_id", auth.userId)
      .order("created_at", { ascending: true });
    data = fallback.data as typeof data;
    error = fallback.error;
  }

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const emailById = new Map<string, string | null>();
  try {
    const users = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
    for (const u of users.data.users ?? []) {
      emailById.set(u.id, u.email ?? null);
    }
  } catch {
    // Non-fatal: still return members without email if auth admin listing is unavailable.
  }

  const members = (data ?? []).map((row) => ({
    id: row.id as string,
    email: emailById.get(row.id as string) ?? null,
    role: row.role as string,
    displayUsername: (row.display_username as string | null) ?? null,
    restrictedFeatures: normalizeRestrictedFeatures(row.restricted_features),
    mobilePhone: (row.mobile_phone as string | null) ?? null,
    exotelVirtualNumber: (row.exotel_virtual_number as string | null) ?? null,
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
  const nextEmail = body.email?.trim().toLowerCase();
  const nextPassword = body.password?.trim();
  if (nextEmail !== undefined && (!nextEmail || !isValidEmail(nextEmail))) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (nextPassword !== undefined && nextPassword.length > 0 && nextPassword.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
      { status: 400 },
    );
  }

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { data: existing, error: existsErr } = await svc
    .from("profiles")
    .select("id, role, restricted_features")
    .eq("id", userId)
    .eq("mailbox_owner_id", auth.userId)
    .maybeSingle();
  if (existsErr) return NextResponse.json({ error: existsErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Team member not found." }, { status: 404 });

  const role =
    body.role === "committee" || body.role === "staff"
      ? body.role
      : ((existing.role as "staff" | "committee" | null) ?? "staff");
  const restrictedFeatures =
    role === "committee"
      ? normalizeRestrictedFeatures(body.restrictedFeatures ?? existing.restricted_features)
      : [];

  const mobileParsed = normalizeOptionalPhone(body.mobilePhone, "Mobile phone");
  if (!mobileParsed.ok) {
    return NextResponse.json({ error: mobileParsed.error }, { status: 400 });
  }
  const exotelParsed = normalizeOptionalPhone(body.exotelVirtualNumber, "Exotel number");
  if (!exotelParsed.ok) {
    return NextResponse.json({ error: exotelParsed.error }, { status: 400 });
  }
  if (body.exotelVirtualNumber !== undefined) {
    const takenErr = await assertExotelNotTaken(svc, auth.userId, exotelParsed.value, userId);
    if (takenErr) return NextResponse.json({ error: takenErr }, { status: 400 });
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

  const profilePatch: Record<string, unknown> = {
    role,
    restricted_features: restrictedFeatures,
    updated_at: new Date().toISOString(),
  };
  if (body.mobilePhone !== undefined) profilePatch.mobile_phone = mobileParsed.value;
  if (body.exotelVirtualNumber !== undefined) {
    profilePatch.exotel_virtual_number = exotelParsed.value;
  }

  let { error: updErr } = await svc
    .from("profiles")
    .update(profilePatch)
    .eq("id", userId)
    .eq("mailbox_owner_id", auth.userId);
  if (updErr && /restricted_features|mobile_phone|exotel_virtual_number/i.test(updErr.message ?? "")) {
    if (role === "committee" && /restricted_features/i.test(updErr.message ?? "")) {
      return NextResponse.json(
        { error: "Database migration 0019_committee_feature_access.sql is required for committee access." },
        { status: 503 }
      );
    }
    if (/mobile_phone|exotel_virtual_number/i.test(updErr.message ?? "")) {
      return NextResponse.json(
        { error: "Database migration 0023_profile_telephony.sql is required for call settings." },
        { status: 503 }
      );
    }
    const { role: _r, restricted_features: _rf, mobile_phone: _mp, exotel_virtual_number: _ev, ...rest } =
      profilePatch;
    updErr = (
      await svc
        .from("profiles")
        .update(rest)
        .eq("id", userId)
        .eq("mailbox_owner_id", auth.userId)
    ).error;
  }
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  if ((nextEmail && nextEmail.length > 0) || (nextPassword && nextPassword.length > 0)) {
    const updatePayload: { email?: string; password?: string } = {};
    if (nextEmail && nextEmail.length > 0) updatePayload.email = nextEmail;
    if (nextPassword && nextPassword.length > 0) updatePayload.password = nextPassword;
    const { error: authErr } = await svc.auth.admin.updateUserById(userId, updatePayload);
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, userId, role, restrictedFeatures, email: nextEmail ?? null });
}

type DeleteBody = {
  userId?: string;
};

export async function DELETE(request: Request) {
  const auth = await assertAdminUserId();
  if (!("userId" in auth)) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: DeleteBody;
  try {
    body = (await request.json()) as DeleteBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const targetId = body.userId?.trim();
  if (!targetId) return NextResponse.json({ error: "userId is required." }, { status: 400 });
  if (targetId === auth.userId) {
    return NextResponse.json({ error: "You cannot delete your own account." }, { status: 400 });
  }

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  const { data: existing, error: existsErr } = await svc
    .from("profiles")
    .select("id, role")
    .eq("id", targetId)
    .eq("mailbox_owner_id", auth.userId)
    .maybeSingle();
  if (existsErr) return NextResponse.json({ error: existsErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Team member not found." }, { status: 404 });
  if ((existing.role as string) === "admin") {
    return NextResponse.json({ error: "Cannot delete an admin account from here." }, { status: 403 });
  }

  const { error: delErr } = await svc.auth.admin.deleteUser(targetId);
  if (delErr) {
    return NextResponse.json({ error: delErr.message ?? "Failed to delete user." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, userId: targetId });
}
