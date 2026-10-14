import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedRequest } from "@/lib/api-auth";
import { createServiceSupabase } from "@/lib/supabase-service";

export type OrgContext = {
  userId: string;
  role: "admin" | "staff";
  /** The account everyone in the workspace shares: the admin's own id, or the admin a staff member is linked to. */
  mailboxOwnerId: string;
  svc: SupabaseClient;
};

/**
 * Who is asking, and which account they belong to. Staff act on their admin's account, so anything
 * an account owns (a connector's API key, say) is keyed by `mailboxOwnerId`, not by the user.
 */
export async function getOrgContext(request: Request): Promise<OrgContext | NextResponse> {
  const authed = await getAuthedRequest(request);
  if (!authed) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const svc = createServiceSupabase();
  const { data: profile } = await svc
    .from("profiles")
    .select("role, mailbox_owner_id")
    .eq("id", authed.user.id)
    .maybeSingle();

  const role = profile?.role === "admin" ? "admin" : "staff";
  const mailboxOwnerId =
    role === "admin" ? authed.user.id : ((profile?.mailbox_owner_id as string | null) ?? null);

  if (!mailboxOwnerId) {
    return NextResponse.json(
      { error: "Your account is not linked to a workspace yet. Ask an admin to connect Google." },
      { status: 400 },
    );
  }
  return { userId: authed.user.id, role, mailboxOwnerId, svc };
}

export function isOrgError(value: unknown): value is NextResponse {
  return value instanceof NextResponse;
}
