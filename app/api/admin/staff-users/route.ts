import { NextResponse } from "next/server";
import { isValidEmail } from "@/lib/broadcast-recipients";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { createServiceSupabase } from "@/lib/supabase-service";
import { isMailboxMigrationNotApplied } from "@/lib/supabase-mailbox-migration";
import { normalizeRestrictedFeatures } from "@/lib/feature-access";

export const runtime = "nodejs";

const MIN_PASSWORD_LEN = 8;

type Body = {
  email?: string;
  password?: string;
  role?: "staff" | "committee";
  restrictedFeatures?: string[];
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
  const restrictedFeatures =
    role === "committee" ? normalizeRestrictedFeatures(body.restrictedFeatures) : [];
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ error: "A valid email is required." }, { status: 400 });
  }
  if (password.length < MIN_PASSWORD_LEN) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` },
      { status: 400 }
    );
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
  const displayUsername = email.split("@")[0]?.slice(0, 64) || "staff";

  let { data: updated, error: profErr } = await svc
    .from("profiles")
    .update({
      role,
      restricted_features: restrictedFeatures,
      mailbox_owner_id: user.id,
      display_username: displayUsername,
      updated_at: new Date().toISOString(),
    })
    .eq("id", newId)
    .select("id")
    .maybeSingle();
  if (profErr && /restricted_features/i.test(profErr.message ?? "")) {
    if (role === "committee") {
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
    });
    if (insErr && /restricted_features/i.test(insErr.message ?? "")) {
      if (role === "committee") {
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
    role,
    restrictedFeatures,
  });
}
