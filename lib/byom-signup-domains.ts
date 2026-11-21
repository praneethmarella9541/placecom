import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * BYOM: which org a new Google sign-in may join, from its email domain.
 *
 *  1. A domain an admin added (org_signup_domains) → that org. One org per domain.
 *  2. Otherwise the domain of an org's common mailbox → that org, but only when exactly one
 *     org's common mailbox is on that domain. An org domain like xlri.ac.in has one; a free
 *     provider like gmail.com is usually shared by several teams, and then nobody joins
 *     automatically — one admin has to claim it under Sign-up domains.
 *
 * Free domains are allowed either way, by product decision: a team whose common mailbox is on
 * gmail.com admits any gmail.com sign-up. New members start with no access to the common
 * mailbox (0084), so joining gives them their own mailbox only until an admin grants more.
 */

// Domains are matched with ILIKE below; restricting the characters keeps % and _ out of it.
const SAFE_DOMAIN = /^[a-z0-9.-]+$/;

export function emailDomain(email: string | null | undefined): string | null {
  const at = email?.lastIndexOf("@") ?? -1;
  if (!email || at < 0) return null;
  const domain = email.slice(at + 1).trim().toLowerCase();
  return domain && SAFE_DOMAIN.test(domain) ? domain : null;
}

/** Orgs whose common mailbox address is on `domain`. */
export async function orgsWithCommonMailboxOn(svc: SupabaseClient, domain: string): Promise<string[]> {
  if (!SAFE_DOMAIN.test(domain)) return [];
  const { data, error } = await svc
    .from("mailboxes")
    .select("org_owner_id")
    .eq("mailbox_type", "common")
    .ilike("gmail_address", `%@${domain}`);
  if (error) return [];
  return Array.from(new Set((data ?? []).map((r) => r.org_owner_id as string)));
}

export async function explicitDomainOwner(svc: SupabaseClient, domain: string): Promise<string | null> {
  const { data } = await svc.from("org_signup_domains").select("org_owner_id").eq("domain", domain).maybeSingle();
  return (data?.org_owner_id as string | undefined) ?? null;
}

/** The org a sign-up with this address joins, or null (they land on /no-access). */
export async function signupOrgForEmail(svc: SupabaseClient, email: string | null): Promise<string | null> {
  const domain = emailDomain(email);
  if (!domain) return null;
  const explicit = await explicitDomainOwner(svc, domain);
  if (explicit) return explicit;
  const orgs = await orgsWithCommonMailboxOn(svc, domain);
  return orgs.length === 1 ? orgs[0] : null;
}

/**
 * Why `orgOwnerId` may not add `domain` to its sign-up domains, or null if it may. Refuses a
 * domain another team owns explicitly, or one another team gets automatically (its common
 * mailbox is the only one on it) — otherwise anyone could redirect XLRI's sign-ups to
 * themselves by adding xlri.ac.in.
 */
export async function domainClaimBlocker(
  svc: SupabaseClient,
  domain: string,
  orgOwnerId: string
): Promise<string | null> {
  const explicit = await explicitDomainOwner(svc, domain);
  if (explicit && explicit !== orgOwnerId) return `${domain} already belongs to another team.`;
  const orgs = await orgsWithCommonMailboxOn(svc, domain);
  if (orgs.length === 1 && orgs[0] !== orgOwnerId) {
    return `${domain} is another team's common mailbox domain, so its sign-ups already go there.`;
  }
  return null;
}

export type CommonDomainStatus =
  /** Sign-ups on the common mailbox's domain join this team without any setting. */
  | "automatic"
  /** This admin added the domain explicitly. */
  | "claimed"
  /** Other teams' common mailboxes share the domain, so it needs claiming. */
  | "shared"
  /** Another team added it explicitly. */
  | "taken";

/** How sign-ups on this org's own common mailbox domain are handled, for the admin panel. */
export async function commonDomainStatus(
  svc: SupabaseClient,
  orgOwnerId: string,
  commonAddress: string | null
): Promise<{ domain: string; status: CommonDomainStatus } | null> {
  const domain = emailDomain(commonAddress);
  if (!domain) return null;
  const explicit = await explicitDomainOwner(svc, domain);
  if (explicit) return { domain, status: explicit === orgOwnerId ? "claimed" : "taken" };
  const orgs = await orgsWithCommonMailboxOn(svc, domain);
  return { domain, status: orgs.length === 1 && orgs[0] === orgOwnerId ? "automatic" : "shared" };
}
