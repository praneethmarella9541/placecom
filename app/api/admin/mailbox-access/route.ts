import { dbErrorMessage } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { assertAdminUserId } from "@/lib/admin-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { invalidateResolvedMailboxCache } from "@/lib/mailbox-google-access";
import { resolveMailboxForUser, isResolveMailboxError } from "@/lib/mailbox-context";
import { isMailboxAccessLevel, type MailboxAccessLevel } from "@/lib/mailbox-context-shared";
import { commonDomainStatus, type CommonDomainStatus } from "@/lib/byom-signup-domains";

export const runtime = "nodejs";

export type MailboxAccessMember = {
  userId: string;
  displayName: string | null;
  email: string | null;
  /** Their own connected mailbox, if any (BYOM). */
  ownMailbox: { address: string | null; status: string } | null;
  /** Effective access to the common mailbox. */
  access: MailboxAccessLevel;
  /** True when an admin set it; false when it is the default (0084 header). */
  explicit: boolean;
};

export type MailboxAccessResponse = {
  commonMailbox: { id: string; address: string | null };
  members: MailboxAccessMember[];
  signupDomains: string[];
  /** How sign-ups on the common mailbox's own domain are handled (null: no address yet). */
  commonDomain: { domain: string; status: CommonDomainStatus } | null;
};

async function commonMailboxFor(svc: ReturnType<typeof createServiceSupabase>, adminId: string) {
  // Resolving as the admin creates the common row if this admin predates 0084.
  const resolved = await resolveMailboxForUser(svc, { userId: adminId, role: "admin", orgOwnerId: adminId, requestedId: null });
  if (isResolveMailboxError(resolved) || !resolved.mailboxId) return null;
  const common = resolved.options.find((o) => o.type === "common");
  return common?.id ? { id: common.id, address: common.address } : null;
}

/** GET /api/admin/mailbox-access — every team member's access to the common mailbox. */
export async function GET(request: Request) {
  const auth = await assertAdminUserId(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const svc = createServiceSupabase();

  const common = await commonMailboxFor(svc, auth.userId);
  if (!common) {
    return NextResponse.json({ error: "Own mailboxes aren't set up on this workspace yet." }, { status: 409 });
  }

  const [{ data: profiles, error: profileErr }, { data: grants }, { data: own }, { data: domains }, commonDomain] = await Promise.all([
    svc.from("profiles").select("id, display_username").eq("mailbox_owner_id", auth.userId).neq("role", "admin"),
    svc.from("user_mailbox_permissions").select("user_id, access_level").eq("mailbox_id", common.id),
    svc
      .from("mailboxes")
      .select("owner_user_id, gmail_address, status")
      .eq("org_owner_id", auth.userId)
      .eq("mailbox_type", "individual"),
    svc.from("org_signup_domains").select("domain").eq("org_owner_id", auth.userId).order("domain"),
    commonDomainStatus(svc, auth.userId, common.address),
  ]);
  if (profileErr) return NextResponse.json({ error: dbErrorMessage(profileErr) }, { status: 500 });

  const grantBy = new Map(((grants ?? []) as { user_id: string; access_level: string }[]).map((g) => [g.user_id, g.access_level]));
  const ownBy = new Map(
    ((own ?? []) as { owner_user_id: string; gmail_address: string | null; status: string }[]).map((m) => [m.owner_user_id, m])
  );

  const ids = ((profiles ?? []) as { id: string }[]).map((p) => p.id);
  const emails = new Map<string, string | null>();
  await Promise.all(
    ids.map(async (id) => {
      const { data } = await svc.auth.admin.getUserById(id);
      emails.set(id, data.user?.email ?? null);
    })
  );

  const members: MailboxAccessMember[] = ((profiles ?? []) as { id: string; display_username: string | null }[]).map((p) => {
    const ownMailbox = ownBy.get(p.id);
    const granted = grantBy.get(p.id);
    const explicit = isMailboxAccessLevel(granted);
    // Same default as resolveMailboxForUser — a disconnected own mailbox still counts as "has one".
    const access: MailboxAccessLevel = explicit ? granted : ownMailbox ? "none" : "full";
    return {
      userId: p.id,
      displayName: p.display_username,
      email: emails.get(p.id) ?? null,
      ownMailbox: ownMailbox ? { address: ownMailbox.gmail_address, status: ownMailbox.status } : null,
      access,
      explicit,
    };
  });
  members.sort((a, b) => (a.displayName ?? a.email ?? "").localeCompare(b.displayName ?? b.email ?? ""));

  const body: MailboxAccessResponse = {
    commonMailbox: common,
    members,
    signupDomains: ((domains ?? []) as { domain: string }[]).map((d) => d.domain),
    commonDomain,
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}

/**
 * PUT /api/admin/mailbox-access { userId, access } — set one member's access to the common
 * mailbox. `access: null` removes the admin's setting so the default applies again.
 */
export async function PUT(request: Request) {
  const auth = await assertAdminUserId(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let body: { userId?: unknown; access?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const userId = typeof body.userId === "string" ? body.userId : "";
  if (!userId) return NextResponse.json({ error: "userId is required" }, { status: 400 });
  if (body.access !== null && !isMailboxAccessLevel(body.access)) {
    return NextResponse.json({ error: "access must be none, view, reply, full or null" }, { status: 400 });
  }

  const svc = createServiceSupabase();
  const { data: member } = await svc
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .eq("mailbox_owner_id", auth.userId)
    .maybeSingle();
  if (!member || member.role === "admin") {
    return NextResponse.json({ error: "User not in your team" }, { status: 403 });
  }

  const common = await commonMailboxFor(svc, auth.userId);
  if (!common) return NextResponse.json({ error: "Own mailboxes aren't set up on this workspace yet." }, { status: 409 });

  const { error } =
    body.access === null
      ? await svc.from("user_mailbox_permissions").delete().eq("user_id", userId).eq("mailbox_id", common.id)
      : await svc.from("user_mailbox_permissions").upsert(
          {
            user_id: userId,
            mailbox_id: common.id,
            access_level: body.access,
            granted_by: auth.userId,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,mailbox_id" }
        );
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });

  // This instance forgets at once; others within their 60 s resolve cache.
  invalidateResolvedMailboxCache(userId);
  return NextResponse.json({ ok: true });
}
