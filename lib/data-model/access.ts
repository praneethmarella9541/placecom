import "server-only";

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedRequest } from "@/lib/api-auth";
import { createServiceSupabase } from "@/lib/supabase-service";
import { loadModuleConfig } from "@/lib/module-config-store";
import { isModuleEnabled } from "@/lib/module-config";
import { commonMailboxAccessForUser } from "@/lib/mailbox-context";
import { mailboxAllows } from "@/lib/mailbox-context-shared";
import type { ObjectDef } from "./types";

/**
 * Who may touch the data model, resolved once per request.
 *
 * The tables are service-role only (0086), so this is the whole access check: every query a route
 * makes must be scoped by `orgOwnerId`, which comes from here and never from the request.
 *
 * Version 1 rule (one level, on purpose; per-object and per-list rules come later):
 *   - admin: read and write, and the only one who can set up or copy data in;
 *   - staff: read needs some access to the common mailbox, write needs reply or full. The contact
 *     data a copy brings in was mined from the common mailbox, and /api/synced-contacts already
 *     hides it from a member without that access; this keeps the same line.
 */

export type DataContext = {
  svc: SupabaseClient;
  userId: string;
  orgOwnerId: string;
  isAdmin: boolean;
  canWrite: boolean;
};

export type DataContextResult = { ok: true; ctx: DataContext } | { ok: false; response: NextResponse };

function deny(error: string, status: number): DataContextResult {
  return { ok: false, response: NextResponse.json({ error }, { status }) };
}

/**
 * Who someone is on the team, kept for a few seconds per server instance. Every Data request needs
 * it, and it is three or four database round trips; a screen that fires several requests at once
 * (a table, its views, its members) used to repeat all of them for each. A role or mailbox-access
 * change therefore reaches this feature within WHO_TTL_MS rather than instantly.
 */
const WHO_TTL_MS = 20_000;
type Who = { isAdmin: boolean; orgOwnerId: string | null; canWrite: boolean; allowed: boolean };
const whoCache = new Map<string, { at: number; who: Who }>();

async function resolveWho(svc: SupabaseClient, userId: string): Promise<Who | null> {
  const hit = whoCache.get(userId);
  if (hit && Date.now() - hit.at < WHO_TTL_MS) return hit.who;

  const { data: profile } = await svc.from("profiles").select("role, mailbox_owner_id").eq("id", userId).maybeSingle();
  if (!profile) return null;
  const isAdmin = profile.role === "admin";
  const orgOwnerId = isAdmin ? userId : ((profile.mailbox_owner_id as string | null) ?? null);
  let canWrite = isAdmin;
  let allowed = true;
  if (!isAdmin && orgOwnerId) {
    const access = await commonMailboxAccessForUser(svc, userId);
    allowed = !!access;
    canWrite = !!access && mailboxAllows(access, "reply");
  }
  const who = { isAdmin, orgOwnerId, canWrite, allowed };
  if (whoCache.size > 2000) whoCache.clear();
  whoCache.set(userId, { at: Date.now(), who });
  return who;
}

export async function requireDataContext(
  request: Request,
  need: "read" | "write" | "admin" = "read"
): Promise<DataContextResult> {
  // The same quick session check the rest of the API uses: the token is verified in the server, with
  // a real call to Supabase only now and then, instead of one on every request.
  const authed = await getAuthedRequest(request);
  if (!authed) return deny("Unauthorized", 401);
  const user = authed.user;

  const svc = createServiceSupabase();

  // Off by default. A 404 rather than a 403: with the module off the feature doesn't exist.
  const [config, who] = await Promise.all([loadModuleConfig(svc), resolveWho(svc, user.id)]);
  if (!isModuleEnabled(config, "dataModel")) return deny("Not found", 404);
  if (!who) return deny("Your account is not set up.", 403);

  const { isAdmin, orgOwnerId, canWrite } = who;
  if (!orgOwnerId) return deny("Your account is not on a team.", 403);
  if (!who.allowed) return deny("You don't have access to this team's data.", 403);

  if (need === "admin" && !isAdmin) return deny("Only an admin can do that.", 403);
  if (need === "write" && !canWrite) return deny("You don't have permission to change this.", 403);

  return { ok: true, ctx: { svc, userId: user.id, orgOwnerId, isAdmin, canWrite } };
}

/** The tables aren't there yet (0086 not applied): say so plainly instead of a raw database error. */
export function missingTableResponse(message: string | undefined): NextResponse | null {
  if (message && /relation .*data_.* does not exist|could not find the table|schema cache/i.test(message)) {
    return NextResponse.json({ error: "The data model isn't set up on this database yet (migration 0086)." }, { status: 503 });
  }
  return null;
}

/**
 * Whether this person may use an object: "write" (read and change), "read", or "none" (hidden).
 * Admins always get "write". Staff get the object's setting, limited to "read" when their mailbox
 * access is view-only.
 */
export function objectAccess(ctx: DataContext, object: Pick<ObjectDef, "staff_access">): "none" | "read" | "write" {
  if (ctx.isAdmin) return "write";
  const setting = object.staff_access ?? "write";
  if (setting === "none") return "none";
  return setting === "write" && ctx.canWrite ? "write" : "read";
}

/** A refusal to send back when this person can't do `need` with the object, else null. */
export function objectDenied(ctx: DataContext, object: Pick<ObjectDef, "staff_access">, need: "read" | "write"): NextResponse | null {
  const access = objectAccess(ctx, object);
  if (access === "none") return NextResponse.json({ error: "You don't have access to this." }, { status: 403 });
  if (need === "write" && access !== "write") return NextResponse.json({ error: "You can look at this but not change it." }, { status: 403 });
  return null;
}
