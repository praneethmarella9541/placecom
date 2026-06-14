import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { assertAdminUserId } from "@/lib/admin-auth";
import { normalizeRestrictedFeatures } from "@/lib/feature-access";
import { mergeRestrictedFeatures } from "@/lib/profile-access";
import { getUserOpenAITokenUsage } from "@/lib/openai-token-limit";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { getExotelVirtualNumbers } from "@/lib/exotel-numbers";
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
  groupId?: string | null;
  openaiTokenLimit?: number | string | null;
  displayUsername?: string | null;
  jobTitle?: string | null;
  bio?: string | null;
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
  const configured = await getExotelVirtualNumbers();
  if (configured.length > 0 && !configured.some((n) => phoneMatches(n, exotel))) {
    return "That number is not an Exotel line on your account (+91). Refresh the Team page and pick from the list.";
  }
  const { data: peers, error } = await svc
    .from("profiles")
    .select("id, exotel_virtual_number")
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

export async function GET(request: Request) {
  const auth = await assertAdminUserId(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json({ error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." }, { status: 500 });
  }

  let { data, error } = await svc
    .from("profiles")
    .select(
      "id, role, display_username, mailbox_owner_id, restricted_features, mobile_phone, exotel_virtual_number, group_id, openai_token_limit, job_title, bio, created_at"
    )
    .eq("mailbox_owner_id", auth.userId)
    .order("created_at", { ascending: true });
  if (error && /restricted_features|mobile_phone|exotel_virtual_number|group_id|openai_token_limit|job_title|bio/i.test(error.message ?? "")) {
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

  const groupIds = Array.from(
    new Set((data ?? []).map((r) => r.group_id).filter(Boolean))
  ) as string[];
  const groupById = new Map<string, { name: string; restricted_features: unknown }>();
  if (groupIds.length) {
    const { data: groups } = await svc
      .from("team_groups")
      .select("id, name, restricted_features")
      .in("id", groupIds);
    for (const g of groups ?? []) {
      groupById.set(g.id as string, {
        name: g.name as string,
        restricted_features: g.restricted_features,
      });
    }
  }

  const members = await Promise.all(
    (data ?? []).map(async (row) => {
      const id = row.id as string;
      const groupId = (row.group_id as string | null) ?? null;
      const group = groupId ? groupById.get(groupId) ?? null : null;
      const tokensUsed = await getUserOpenAITokenUsage(id);
      const limitRaw = row.openai_token_limit;
      const openaiTokenLimit =
        limitRaw == null || limitRaw === "" ? null : Math.max(0, Number(limitRaw) || 0);

      return {
        id,
        email: emailById.get(id) ?? null,
        role: row.role as string,
        displayUsername: (row.display_username as string | null) ?? null,
        jobTitle: (row.job_title as string | null) ?? null,
        bio: (row.bio as string | null) ?? null,
        restrictedFeatures: mergeRestrictedFeatures(
          { role: row.role as string, restricted_features: row.restricted_features },
          group
        ),
        legacyRestrictedFeatures: normalizeRestrictedFeatures(row.restricted_features),
        mobilePhone: (row.mobile_phone as string | null) ?? null,
        exotelVirtualNumber: (row.exotel_virtual_number as string | null) ?? null,
        groupId,
        groupName: group?.name ?? null,
        openaiTokenLimit,
        tokensUsed,
      };
    })
  );

  return NextResponse.json({ members });
}

export async function PATCH(request: Request) {
  const auth = await assertAdminUserId(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const adminUserId = auth.userId;

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
  if (nextEmail && !isValidEmail(nextEmail)) {
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
    .eq("mailbox_owner_id", adminUserId)
    .maybeSingle();
  if (existsErr) return NextResponse.json({ error: existsErr.message }, { status: 500 });
  if (!existing) return NextResponse.json({ error: "Team member not found." }, { status: 404 });

  const role =
    body.role === "committee" || body.role === "staff"
      ? body.role
      : ((existing.role as "staff" | "committee" | null) ?? "staff");

  let groupId: string | null | undefined = undefined;
  if (body.groupId !== undefined) {
    if (body.groupId === null || body.groupId === "") {
      groupId = null;
    } else {
      const gid = body.groupId.trim();
      const { data: groupRow } = await svc
        .from("team_groups")
        .select("id")
        .eq("id", gid)
        .eq("mailbox_owner_id", adminUserId)
        .maybeSingle();
      if (!groupRow) {
        return NextResponse.json({ error: "Group not found." }, { status: 404 });
      }
      groupId = gid;
    }
  }

  const assignedGroup = body.groupId !== undefined && Boolean(body.groupId?.trim());
  const effectiveRole = assignedGroup ? "staff" : role;
  const restrictedFeatures =
    assignedGroup || effectiveRole !== "committee"
      ? []
      : normalizeRestrictedFeatures(body.restrictedFeatures ?? existing.restricted_features);

  const mobileParsed = normalizeOptionalPhone(body.mobilePhone, "Mobile phone");
  if (!mobileParsed.ok) {
    return NextResponse.json({ error: mobileParsed.error }, { status: 400 });
  }
  const exotelParsed = normalizeOptionalPhone(body.exotelVirtualNumber, "Exotel number");
  if (!exotelParsed.ok) {
    return NextResponse.json({ error: exotelParsed.error }, { status: 400 });
  }
  if (body.exotelVirtualNumber !== undefined) {
    const takenErr = await assertExotelNotTaken(
      svc,
      adminUserId,
      exotelParsed.value ?? null,
      userId
    );
    if (takenErr) return NextResponse.json({ error: takenErr }, { status: 400 });
  }

  if (effectiveRole === "committee" && !assignedGroup) {
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

  const basePatch: Record<string, unknown> = {
    role: effectiveRole,
    restricted_features: restrictedFeatures,
    updated_at: new Date().toISOString(),
  };
  if (body.displayUsername !== undefined) {
    const raw = body.displayUsername?.trim() ?? "";
    basePatch.display_username = raw.slice(0, 64) || null;
  }
  if (body.mobilePhone !== undefined) basePatch.mobile_phone = mobileParsed.value;
  if (body.exotelVirtualNumber !== undefined) {
    basePatch.exotel_virtual_number = exotelParsed.value;
  }

  const extendedPatch: Record<string, unknown> = { ...basePatch };
  if (body.groupId !== undefined) extendedPatch.group_id = groupId;
  if (body.openaiTokenLimit !== undefined) {
    if (body.openaiTokenLimit === null || body.openaiTokenLimit === "") {
      extendedPatch.openai_token_limit = null;
    } else {
      const limit = Math.max(0, Math.floor(Number(body.openaiTokenLimit) || 0));
      extendedPatch.openai_token_limit = limit > 0 ? limit : null;
    }
  }
  if (body.jobTitle !== undefined) {
    const raw = body.jobTitle?.trim() ?? "";
    extendedPatch.job_title = raw.slice(0, 120) || null;
  }
  if (body.bio !== undefined) {
    const raw = body.bio?.trim() ?? "";
    extendedPatch.bio = raw.slice(0, 500) || null;
  }

  function migrationErrorForColumn(errMsg: string): string | null {
    if (/restricted_features/i.test(errMsg)) {
      return "Database migration 0019_committee_feature_access.sql is required for committee access.";
    }
    if (/mobile_phone|exotel_virtual_number/i.test(errMsg)) {
      return "Database migration 0023_profile_telephony.sql is required for call settings.";
    }
    if (/group_id|openai_token_limit|job_title|bio/i.test(errMsg)) {
      return "Database migration 0032_team_groups_profile_tokens.sql is required for groups, token limits, and profile fields.";
    }
    return null;
  }

  async function applyProfilePatch(patch: Record<string, unknown>) {
    return svc
      .from("profiles")
      .update(patch)
      .eq("id", userId)
      .eq("mailbox_owner_id", adminUserId)
      .select("id")
      .maybeSingle();
  }

  let { data: updatedRow, error: updErr } = await applyProfilePatch(extendedPatch);
  if (
    updErr &&
    /restricted_features|mobile_phone|exotel_virtual_number|group_id|openai_token_limit|job_title|bio/i.test(
      updErr.message ?? ""
    )
  ) {
    const migrationMsg = migrationErrorForColumn(updErr.message ?? "");
    if (
      migrationMsg &&
      (effectiveRole !== "committee" ||
        assignedGroup ||
        !/restricted_features/i.test(updErr.message ?? ""))
    ) {
      // Retry without newer columns (0032) so telephony + core fields still persist.
      if (/group_id|openai_token_limit|job_title|bio/i.test(updErr.message ?? "")) {
        const retry = await applyProfilePatch(basePatch);
        updatedRow = retry.data;
        updErr = retry.error;
      } else {
        return NextResponse.json({ error: migrationMsg }, { status: 503 });
      }
    } else if (migrationMsg) {
      return NextResponse.json({ error: migrationMsg }, { status: 503 });
    }
  }
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  if (!updatedRow) {
    return NextResponse.json({ error: "Team member not found or update did not apply." }, { status: 404 });
  }

  if ((nextEmail && nextEmail.length > 0) || (nextPassword && nextPassword.length > 0)) {
    const updatePayload: { email?: string; password?: string } = {};
    if (nextEmail && nextEmail.length > 0) updatePayload.email = nextEmail;
    if (nextPassword && nextPassword.length > 0) updatePayload.password = nextPassword;
    const { error: authErr } = await svc.auth.admin.updateUserById(userId, updatePayload);
    if (authErr) {
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true, userId, role: effectiveRole, restrictedFeatures, email: nextEmail ?? null });
}

type DeleteBody = {
  userId?: string;
};

export async function DELETE(request: Request) {
  const auth = await assertAdminUserId(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

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
