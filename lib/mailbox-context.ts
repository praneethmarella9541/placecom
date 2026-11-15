import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isModuleEnabled } from "@/lib/module-config";
import { loadModuleConfig } from "@/lib/module-config-store";
import {
  MAILBOX_COOKIE,
  MAILBOX_HEADER,
  isMailboxAccessLevel,
  type GrantedMailboxAccess,
  type MailboxAccessLevel,
  type MailboxOption,
  type MailboxType,
} from "@/lib/mailbox-context-shared";

/**
 * Which Gmail account a request works in, and what the caller may do there.
 *
 * Before BYOM one id answered two questions: `mailboxOwnerId` was both the org
 * (the admin's user id, the tenant key behind every RLS policy) and the Gmail
 * account whose token every Google call used. BYOM keeps the first meaning and
 * splits off the second as `credentialOwnerId`. For the common mailbox they are
 * the same id, so every existing caller sees no change.
 *
 * The access rule is the one in the 0084 migration header — keep the two in
 * sync. With the `byom` module off (or 0084 not applied) this returns the
 * legacy answer for everyone: the common mailbox, full access.
 */

export type ResolvedMailbox = {
  /** The org: the admin's user id. Tenant key for contacts, CRM, sequences, analytics. */
  orgOwnerId: string;
  /** mailboxes.id; null when BYOM is off or not migrated (legacy common mailbox). */
  mailboxId: string | null;
  mailboxType: MailboxType;
  /** Whose google_mailbox_credentials row to use — the Gmail account. Also the per-account quota/cache key. */
  credentialOwnerId: string;
  access: GrantedMailboxAccess;
  /** Gmail label ids this user is limited to in this mailbox; null = all. */
  labelScope: string[] | null;
  /** Every mailbox the user may switch to (empty when BYOM is off). */
  options: MailboxOption[];
  /**
   * 0084/0085 are applied, so `mailbox_id` columns exist and can be filtered on. True even
   * with the module off: rows written while it was on must stay out of the common views.
   */
  migrated: boolean;
};

export type ResolveMailboxError = { error: string; status: 403 };

type MailboxRow = {
  id: string;
  mailbox_type: MailboxType;
  owner_user_id: string;
  gmail_address: string | null;
  status: string;
};

/** The mailbox id the caller asked for: the mobile header first, then the web cookie. */
export function requestedMailboxId(request: Request | null | undefined): string | null {
  if (!request) return null;
  const header = request.headers.get(MAILBOX_HEADER)?.trim();
  if (header) return header;
  const cookie = request.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === MAILBOX_COOKIE) return decodeURIComponent(rest.join("=")).trim() || null;
  }
  return null;
}

function legacy(orgOwnerId: string, migrated: boolean): ResolvedMailbox {
  return {
    migrated,
    orgOwnerId,
    mailboxId: null,
    mailboxType: "common",
    credentialOwnerId: orgOwnerId,
    access: "full",
    labelScope: null,
    options: [],
  };
}

export async function isByomEnabled(svc: SupabaseClient): Promise<boolean> {
  return isModuleEnabled(await loadModuleConfig(svc), "byom");
}

/**
 * Resolves the caller's mailbox. `orgOwnerId` is the profile-derived org (the
 * admin's id, or the admin a staff member is linked to) — callers already have
 * it, so it is passed in rather than re-read.
 */
export async function resolveMailboxForUser(
  svc: SupabaseClient,
  params: { userId: string; role: string; orgOwnerId: string; requestedId: string | null }
): Promise<ResolvedMailbox | ResolveMailboxError> {
  const { userId, role, orgOwnerId, requestedId } = params;
  const enabled = await isByomEnabled(svc);
  const { data: rows, error } = await svc
    .from("mailboxes")
    .select("id, mailbox_type, owner_user_id, gmail_address, status")
    .eq("org_owner_id", orgOwnerId)
    .or(`mailbox_type.eq.common,owner_user_id.eq.${userId}`);
  // 0084 not applied yet: behave exactly as before it.
  if (error) return legacy(orgOwnerId, false);
  if (!enabled) return legacy(orgOwnerId, true);

  const list = (rows ?? []) as MailboxRow[];
  let common = list.find((m) => m.mailbox_type === "common") ?? null;
  // An admin added after 0084 has no common row yet; create it on first use.
  if (!common) common = await ensureCommonMailbox(svc, orgOwnerId);
  const own =
    list.find((m) => m.mailbox_type === "individual" && m.owner_user_id === userId && m.status === "active") ?? null;

  let commonAccess: MailboxAccessLevel = "full";
  let labelScope: string[] | null = null;
  if (role !== "admin" && common) {
    const { data: grant } = await svc
      .from("user_mailbox_permissions")
      .select("access_level, label_scope")
      .eq("user_id", userId)
      .eq("mailbox_id", common.id)
      .maybeSingle();
    if (grant && isMailboxAccessLevel(grant.access_level)) {
      commonAccess = grant.access_level;
      labelScope = (grant.label_scope as string[] | null) ?? null;
    } else {
      // No row: existing staff keep what they have today; a BYOM sign-up starts with nothing.
      commonAccess = own ? "none" : "full";
    }
  }

  const options: MailboxOption[] = [];
  if (own) options.push({ id: own.id, type: "individual", address: own.gmail_address, access: "full" });
  if (common && commonAccess !== "none") {
    options.push({ id: common.id, type: "common", address: common.gmail_address, access: commonAccess });
  }

  if (options.length === 0) {
    return {
      error: "You don't have access to a mailbox yet. Connect your own with Google, or ask your admin for access.",
      status: 403,
    };
  }

  // Default when nothing (or something unavailable) is requested: your own
  // mailbox if you have one, else the common one — which is today's behaviour.
  const chosen = options.find((o) => o.id === requestedId) ?? options[0];
  if (chosen.type === "individual") {
    return {
      orgOwnerId,
      mailboxId: chosen.id,
      mailboxType: "individual",
      credentialOwnerId: userId,
      access: "full",
      labelScope: null,
      options,
      migrated: true,
    };
  }
  return {
    orgOwnerId,
    mailboxId: chosen.id,
    mailboxType: "common",
    credentialOwnerId: orgOwnerId,
    access: chosen.access,
    labelScope,
    options,
    migrated: true,
  };
}

export function isResolveMailboxError(value: unknown): value is ResolveMailboxError {
  return Boolean(value && typeof value === "object" && "error" in value);
}

async function ensureCommonMailbox(svc: SupabaseClient, orgOwnerId: string): Promise<MailboxRow | null> {
  const { data: cred } = await svc
    .from("google_mailbox_credentials")
    .select("gmail_address")
    .eq("owner_user_id", orgOwnerId)
    .maybeSingle();
  const { data } = await svc
    .from("mailboxes")
    .upsert(
      {
        org_owner_id: orgOwnerId,
        mailbox_type: "common",
        owner_user_id: orgOwnerId,
        gmail_address: (cred?.gmail_address as string | null) ?? null,
      },
      { onConflict: "owner_user_id", ignoreDuplicates: true }
    )
    .select("id, mailbox_type, owner_user_id, gmail_address, status")
    .maybeSingle();
  if (data) return data as MailboxRow;
  const { data: existing } = await svc
    .from("mailboxes")
    .select("id, mailbox_type, owner_user_id, gmail_address, status")
    .eq("owner_user_id", orgOwnerId)
    .eq("mailbox_type", "common")
    .maybeSingle();
  return (existing as MailboxRow | null) ?? null;
}

/** The org's common mailbox id, for stamping rows written outside a request (cron). */
export async function commonMailboxId(svc: SupabaseClient, orgOwnerId: string): Promise<string | null> {
  const { data, error } = await svc
    .from("mailboxes")
    .select("id")
    .eq("org_owner_id", orgOwnerId)
    .eq("mailbox_type", "common")
    .maybeSingle();
  if (error) return null;
  return (data?.id as string | undefined) ?? null;
}

/**
 * The caller's access to their org's common mailbox, whatever mailbox they are working in now;
 * null when they have none. Full when BYOM is off (everyone works in the common mailbox).
 *
 * For data derived from the common mailbox that isn't read through a Gmail token — the synced
 * contact book (lib/people-mailbox-sync.ts) and its sync state. RLS scopes those to the org, so
 * without this a member who connected only their own mailbox would see contacts mined from the
 * common one.
 */
export async function commonMailboxAccessForUser(
  svc: SupabaseClient,
  userId: string
): Promise<GrantedMailboxAccess | null> {
  const { data: profile } = await svc
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", userId)
    .maybeSingle();
  if (!profile) return null;
  const role = profile.role as string;
  const orgOwnerId = role === "admin" ? userId : ((profile.mailbox_owner_id as string | null) ?? null);
  if (!orgOwnerId) return null;
  const resolved = await resolveMailboxForUser(svc, { userId, role, orgOwnerId, requestedId: null });
  if (isResolveMailboxError(resolved)) return null;
  // Legacy (module off / not migrated) lists no options: the common mailbox, full access.
  if (resolved.options.length === 0) return "full";
  return resolved.options.find((o) => o.type === "common")?.access ?? null;
}
