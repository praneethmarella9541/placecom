import { NextResponse } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase-server";
import { mergeRestrictedFeatures } from "@/lib/profile-access";
import { getUserTokenLimitStatus } from "@/lib/openai-token-limit";
import { getAuthedRequest } from "@/lib/api-auth";

export const runtime = "nodejs";

type PatchBody = {
  displayUsername?: string;
  jobTitle?: string | null;
  bio?: string | null;
};

export type MeProfileResponse = {
  sessionEmail: string | null;
  displayUsername: string | null;
  jobTitle: string | null;
  bio: string | null;
  role: string;
  groupName: string | null;
  restrictedFeatures: string[];
  tokenLimit: number | null;
  tokensUsed: number;
  tokensRemaining: number | null;
  canChangePassword: boolean;
};

/** GET /api/me/profile — signed-in user's portal profile */
export async function GET(request: Request) {
  const authed = await getAuthedRequest(request);
  let user = authed?.user ?? null;
  const supabase = createServerSupabaseClient();
  if (!user) {
    const { data, error: userErr } = await supabase.auth.getUser();
    if (userErr || !data.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    user = data.user;
  }

  let { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("role, display_username, job_title, bio, restricted_features, group_id")
    .eq("id", user.id)
    .maybeSingle();

  if (profileErr && /job_title|bio|group_id/i.test(profileErr.message ?? "")) {
    const fallback = await supabase
      .from("profiles")
      .select("role, display_username, restricted_features")
      .eq("id", user.id)
      .maybeSingle();
    profile = fallback.data as typeof profile;
    profileErr = fallback.error;
  }

  if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 });

  let group: { name: string; restricted_features: unknown } | null = null;
  if (profile?.group_id) {
    const { data: g } = await supabase
      .from("team_groups")
      .select("name, restricted_features")
      .eq("id", profile.group_id as string)
      .maybeSingle();
    if (g) group = g as { name: string; restricted_features: unknown };
  }

  const tokenStatus = await getUserTokenLimitStatus(user.id);
  const appMeta = user.app_metadata as { provider?: string } | undefined;
  const canChangePassword = appMeta?.provider !== "google";

  const body: MeProfileResponse = {
    sessionEmail: user.email ?? null,
    displayUsername: (profile?.display_username as string | null) ?? null,
    jobTitle: (profile?.job_title as string | null) ?? null,
    bio: (profile?.bio as string | null) ?? null,
    role: (profile?.role as string) ?? "staff",
    groupName: group?.name ?? null,
    restrictedFeatures: mergeRestrictedFeatures(
      {
        role: profile?.role as string,
        restricted_features: profile?.restricted_features,
      },
      group
    ),
    tokenLimit: tokenStatus.limit,
    tokensUsed: tokenStatus.used,
    tokensRemaining: tokenStatus.remaining,
    canChangePassword,
  };

  return NextResponse.json(body);
}

/** PATCH /api/me/profile — update display name and optional profile fields */
export async function PATCH(request: Request) {
  const supabase = createServerSupabaseClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr || !user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.displayUsername !== undefined) {
    const raw = body.displayUsername.trim();
    patch.display_username = raw.slice(0, 64) || null;
  }
  if (body.jobTitle !== undefined) {
    const raw = body.jobTitle?.trim() ?? "";
    patch.job_title = raw.slice(0, 120) || null;
  }
  if (body.bio !== undefined) {
    const raw = body.bio?.trim() ?? "";
    patch.bio = raw.slice(0, 500) || null;
  }

  if (Object.keys(patch).length <= 1) {
    return NextResponse.json({ error: "No fields to update." }, { status: 400 });
  }

  const { error } = await supabase.from("profiles").update(patch).eq("id", user.id);
  if (error) {
    if (/job_title|bio/i.test(error.message ?? "")) {
      const fallback: Record<string, unknown> = { updated_at: patch.updated_at };
      if (patch.display_username !== undefined) fallback.display_username = patch.display_username;
      const { error: fbErr } = await supabase.from("profiles").update(fallback).eq("id", user.id);
      if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
