import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { CRM_STAGE_SELECT, listOrSeedStages } from "@/lib/crm-stages";

export const runtime = "nodejs";

/** The 0054 migration hasn't been applied to this database yet. */
const MISSING_TABLE = /relation .*crm_stages.* does not exist|could not find the table/i;

/**
 * The kanban columns are personal per signed-in user (0055 re-scoped this off
 * mailbox_owner_id — a whole admin team sharing one board — onto user_id), so
 * every route here just needs the caller's own id. No "not linked to a team"
 * case anymore: unlike the old team-scoped board, there's no admin-linkage
 * precondition for having a personal one.
 */
async function requireAuth(request: Request) {
  const { supabase, user } = await getUserOr401(request);
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) } as const;
  return { supabase, user } as const;
}

export async function GET(request: Request) {
  const ctx = await requireAuth(request);
  if ("error" in ctx) return ctx.error;

  const { stages, error } = await listOrSeedStages(ctx.supabase, ctx.user.id);
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
  const ctx = await requireAuth(request);
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
    .eq("user_id", ctx.user.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data, error } = await ctx.supabase
    .from("crm_stages")
    .insert({
      user_id: ctx.user.id,
      created_by: ctx.user.id,
      name,
      description: typeof body.description === "string" ? body.description.trim() || null : null,
      color: typeof body.color === "string" ? body.color : null,
      position: ((last?.position as number | undefined) ?? -1) + 1,
    })
    .select(CRM_STAGE_SELECT)
    .single();

  if (error) {
    const duplicate = /duplicate key|crm_stages_user_name_key/i.test(error.message);
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
  const ctx = await requireAuth(request);
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
      .eq("user_id", ctx.user.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { stages, error } = await listOrSeedStages(ctx.supabase, ctx.user.id);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return NextResponse.json({ stages });
}
