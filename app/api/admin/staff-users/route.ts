import { NextResponse } from "next/server";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isMailboxMigrationNotApplied } from "@/lib/supabase-mailbox-migration";
import { normalizeRestrictedFeatures } from "@/lib/feature-access";
import { listConfiguredExotelNumbers } from "@/lib/exotel-numbers";
import { isValidE164, normalizePhone, phoneMatches } from "@/lib/phone";

export const runtime = "nodejs";

const MIN_PASSWORD_LEN = 8;

type Body = {
  email?: string;
  password?: string;
  role?: "staff" | "committee";
  restrictedFeatures?: string[];
  mobilePhone?: string | null;
  exotelVirtualNumber?: string | null;
  groupId?: string | null;
  openaiTokenLimit?: number | null;
  displayUsername?: string | null;
  jobTitle?: string | null;
};

/**
 * Admin-only: creates a staff auth user and links their profile to this admin's mailbox.
 */
export async function POST(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: me, error: meErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle();

  if (meErr && isMailboxMigrationNotApplied(meErr)) {
    return NextResponse.json(
      { error: "Database migration not applied (profiles table)." },
      { status: 503 }
    );
  }
  if (meErr) {
    return NextResponse.json({ error: meErr.message }, { status: 500 });
  }
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password ?? "";
  const role = body.role === "committee" ? "committee" : "staff";
  const groupIdRaw = body.groupId?.trim() ?? "";
  const hasGroup = Boolean(groupIdRaw);
  const restrictedFeatures =
    hasGroup || role !== "committee"
      ? []
      : normalizeRestrictedFeatures(body.restrictedFeatures);
  const effectiveRole = hasGroup ? "staff" : role;
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
      { status: 400 }
    );
  }

  let mobilePhone: string | null = null;
  if (body.mobilePhone != null && String(body.mobilePhone).trim() !== "") {
    mobilePhone = normalizePhone(String(body.mobilePhone).trim());
    if (!isValidE164(mobilePhone)) {
      return NextResponse.json(
        { error: "Mobile phone must include country code, e.g. +919876543210." },
        { status: 400 }
      );
    }
  }
  let exotelVirtualNumber: string | null = null;
  if (body.exotelVirtualNumber != null && String(body.exotelVirtualNumber).trim() !== "") {
    exotelVirtualNumber = normalizePhone(String(body.exotelVirtualNumber).trim());
    if (!isValidE164(exotelVirtualNumber)) {
      return NextResponse.json(
        { error: "Exotel number must include country code, e.g. +919513886363." },
        { status: 400 }
      );
    }
    const configured = listConfiguredExotelNumbers();
    if (configured.length > 0 && !configured.some((n) => phoneMatches(n, exotelVirtualNumber!))) {
      return NextResponse.json(
        { error: "That Exotel number is not configured on the server." },
        { status: 400 }
      );
    }
  }

  if (email === user.email?.trim().toLowerCase()) {
    return NextResponse.json(
      { error: "Use a different email than your own admin account." },
      { status: 400 }
    );
  }

  let svc: ReturnType<typeof createServiceSupabase>;
  try {
    svc = createServiceSupabase();
  } catch {
    return NextResponse.json(
      { error: "Server is missing SUPABASE_SERVICE_ROLE_KEY." },
      { status: 500 }
    );
  }

  if (role === "committee" && !hasGroup) {
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

  const { data: created, error: createErr } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createErr || !created.user) {
    const msg = createErr?.message ?? "Failed to create user";
    if (/already|registered|exists|duplicate/i.test(msg)) {
      return NextResponse.json(
        { error: "An account with this email already exists. Link them from Supabase or use a different email." },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  const newId = created.user.id;
  const displayUsername =
    body.displayUsername?.trim().slice(0, 64) ||
    email.split("@")[0]?.slice(0, 64) ||
    "staff";

  let groupId: string | null = null;
  if (hasGroup) {
    const { data: groupRow } = await svc
      .from("team_groups")
      .select("id")
      .eq("id", groupIdRaw)
      .eq("mailbox_owner_id", user.id)
      .maybeSingle();
    if (!groupRow) {
      await svc.auth.admin.deleteUser(newId);
      return NextResponse.json({ error: "Group not found." }, { status: 404 });
    }
    groupId = groupIdRaw;
  }

  let openaiTokenLimit: number | null = null;
  if (body.openaiTokenLimit != null && body.openaiTokenLimit !== "") {
    const limit = Math.max(0, Math.floor(Number(body.openaiTokenLimit) || 0));
    openaiTokenLimit = limit > 0 ? limit : null;
  }

  const jobTitle = body.jobTitle?.trim().slice(0, 120) || null;

  if (exotelVirtualNumber) {
    const { data: peers, error: peerErr } = await svc
      .from("profiles")
      .select("id, exotel_virtual_number")
      .eq("mailbox_owner_id", user.id);
    if (peerErr && /exotel_virtual_number/i.test(peerErr.message ?? "")) {
      await svc.auth.admin.deleteUser(newId);
      return NextResponse.json(
        { error: "Database migration 0023_profile_telephony.sql is required for call settings." },
        { status: 503 }
      );
    }
    if (
      peers?.some(
        (p) => p.exotel_virtual_number && phoneMatches(p.exotel_virtual_number as string, exotelVirtualNumber)
      )
    ) {
      await svc.auth.admin.deleteUser(newId);
      return NextResponse.json(
        { error: "That Exotel number is already assigned to another team member." },
        { status: 400 }
      );
    }
  }

  const telephonyFields = {
    mobile_phone: mobilePhone,
    exotel_virtual_number: exotelVirtualNumber,
  };

  let { data: updated, error: profErr } = await svc
    .from("profiles")
    .update({
      role: effectiveRole,
      restricted_features: restrictedFeatures,
      mailbox_owner_id: user.id,
      display_username: displayUsername,
      group_id: groupId,
      openai_token_limit: openaiTokenLimit,
      job_title: jobTitle,
      ...telephonyFields,
      updated_at: new Date().toISOString(),
    })
    .eq("id", newId)
    .select("id")
    .maybeSingle();
  if (profErr && /mobile_phone|exotel_virtual_number/i.test(profErr.message ?? "")) {
    await svc.auth.admin.deleteUser(newId);
    return NextResponse.json(
      { error: "Database migration 0023_profile_telephony.sql is required for call settings." },
      { status: 503 }
    );
  }
  if (profErr && /restricted_features/i.test(profErr.message ?? "")) {
    if (role === "committee" && !hasGroup) {
      await svc.auth.admin.deleteUser(newId);
      return NextResponse.json(
        { error: "Database migration 0019_committee_feature_access.sql is required for committee access." },
        { status: 503 }
      );
    }
    const fallback = await svc
      .from("profiles")
      .update({
        role,
        mailbox_owner_id: user.id,
        display_username: displayUsername,
        ...telephonyFields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", newId)
      .select("id")
      .maybeSingle();
    updated = fallback.data;
    profErr = fallback.error;
  }

  if (profErr) {
    await svc.auth.admin.deleteUser(newId);
    return NextResponse.json({ error: profErr.message }, { status: 500 });
  }

  if (!updated) {
    let { error: insErr } = await svc.from("profiles").insert({
      id: newId,
      role,
      restricted_features: restrictedFeatures,
      mailbox_owner_id: user.id,
      display_username: displayUsername,
      ...telephonyFields,
    });
    if (insErr && /restricted_features/i.test(insErr.message ?? "")) {
      if (role === "committee" && !hasGroup) {
        await svc.auth.admin.deleteUser(newId);
        return NextResponse.json(
          { error: "Database migration 0019_committee_feature_access.sql is required for committee access." },
          { status: 503 }
        );
      }
      insErr = (
        await svc.from("profiles").insert({
          id: newId,
          role,
          mailbox_owner_id: user.id,
          display_username: displayUsername,
          ...telephonyFields,
        })
      ).error;
    }
    if (insErr) {
      await svc.auth.admin.deleteUser(newId);
      return NextResponse.json(
        { error: `Could not create profile row: ${insErr.message}` },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    ok: true,
    userId: newId,
    email,
    role: effectiveRole,
    restrictedFeatures,
    groupId,
  });
}
