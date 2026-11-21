import { dbErrorMessage } from "@/lib/api-error";
import { NextResponse } from "next/server";
import { assertAdminUserId } from "@/lib/admin-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { domainClaimBlocker } from "@/lib/byom-signup-domains";

export const runtime = "nodejs";

/**
 * Extra email domains whose Google accounts join this admin's team, with their own mailbox,
 * the first time they sign in — on top of the common mailbox's own domain, which needs no
 * entry here unless other teams share it (lib/byom-signup-domains.ts). Free providers are
 * allowed: adding gmail.com admits any Gmail user, with no common-mailbox access to start.
 */

const DOMAIN_RE = /^(?=.{3,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

function parseDomain(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const d = value.trim().toLowerCase().replace(/^@/, "");
  return DOMAIN_RE.test(d) ? d : null;
}

async function readDomain(request: Request): Promise<string | NextResponse> {
  let body: { domain?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const domain = parseDomain(body.domain);
  if (!domain) return NextResponse.json({ error: "Enter a domain like xlri.ac.in" }, { status: 400 });
  return domain;
}

/** POST { domain } */
export async function POST(request: Request) {
  const auth = await assertAdminUserId(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const domain = await readDomain(request);
  if (domain instanceof NextResponse) return domain;
  const svc = createServiceSupabase();
  const blocked = await domainClaimBlocker(svc, domain, auth.userId);
  if (blocked) return NextResponse.json({ error: blocked }, { status: 409 });
  const { error } = await svc
    .from("org_signup_domains")
    .upsert({ domain, org_owner_id: auth.userId }, { onConflict: "domain", ignoreDuplicates: true });
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true, domain });
}

/** DELETE { domain } — stops new sign-ups; members who already joined stay. */
export async function DELETE(request: Request) {
  const auth = await assertAdminUserId(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const domain = await readDomain(request);
  if (domain instanceof NextResponse) return domain;

  const svc = createServiceSupabase();
  const { error } = await svc.from("org_signup_domains").delete().eq("domain", domain).eq("org_owner_id", auth.userId);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
