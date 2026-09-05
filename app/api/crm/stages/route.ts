import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { resolveMailboxOwnerId } from "@/lib/team-scope";
import { CRM_STAGE_SELECT, listOrSeedStages } from "@/lib/crm-stages";

export const runtime = "nodejs";

/** The 0054 migration hasn't been applied to this database yet. */
const MISSING_TABLE = /relation .*crm_stages.* does not exist|could not find the table/i;

/**
 * The kanban columns are per-team config (see the 0054 migration), so every
 * route here resolves the caller's mailbox owner first. A staff user with no
 * admin linked yet has no board to write to — that's a 409 rather than a
 * silent write to a null owner, which would be invisible to everyone.
 */
async function requireBoardOwner(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  const mailboxOwnerId = await resolveMailboxOwnerId(supabase, user.id);
  if (!mailboxOwnerId) {
    return {
      error: NextResponse.json(
        { error: "No CRM board yet — your account isn't linked to a team." },
        { status: 409 }
      ),
    } as const;
  }
  return { supabase, user, mailboxOwnerId } as const;
}

export async function GET(request: Request) {
  const ctx = await requireBoardOwner(request);
  if ("error" in ctx) return ctx.error;

  const { stages, error } = await listOrSeedStages(ctx.supabase, ctx.mailboxOwnerId, ctx.user.id);
  if (error) {
    if (MISSING_TABLE.test(error)) {
      return NextResponse.json(
        { error: "CRM tables aren't set up yet — apply migration 0054 to this database." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error }, { status: 500 });
  }
  return NextResponse.json({ stages });
}

export async function POST(request: Request) {
  const ctx = await requireBoardOwner(request);
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    description?: unknown;
    color?: unknown;
  };
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  // Append to the end of the board.
  const { data: last } = await ctx.supabase
    .from("crm_stages")
    .select("position")
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.supabase
    .from("crm_stages")
    .insert({
      mailbox_owner_id: ctx.mailboxOwnerId,
      created_by: ctx.user.id,
      name,
      description: typeof body.description === "string" ? body.description.trim() || null : null,
      color: typeof body.color === "string" ? body.color : null,
      position: ((last?.position as number | undefined) ?? -1) + 1,
    })
    .select(CRM_STAGE_SELECT)
    .single();

  if (error) {
    const duplicate = /duplicate key|crm_stages_owner_name_key/i.test(error.message);
    return NextResponse.json(
      { error: duplicate ? `A "${name}" column already exists.` : error.message },
      { status: duplicate ? 409 : 500 }
    );
  }
  return NextResponse.json({ stage: data });
}

/**
 * PATCH /api/crm/stages — reorder the whole board in one call.
 * Takes the full ordered list of stage ids; writing positions one PATCH at a
 * time would leave the board briefly inconsistent mid-drag.
 */
export async function PATCH(request: Request) {
  const ctx = await requireBoardOwner(request);
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => ({}))) as { order?: unknown };
  if (!Array.isArray(body.order) || body.order.some((id) => typeof id !== "string")) {
    return NextResponse.json({ error: "order must be an array of stage ids" }, { status: 400 });
  }

  const ids = body.order as string[];
  for (let i = 0; i < ids.length; i++) {
    const { error } = await ctx.supabase
      .from("crm_stages")
      .update({ position: i, updated_at: new Date().toISOString() })
      .eq("id", ids[i])
      .eq("mailbox_owner_id", ctx.mailboxOwnerId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { stages, error } = await listOrSeedStages(ctx.supabase, ctx.mailboxOwnerId, ctx.user.id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ stages });
}
