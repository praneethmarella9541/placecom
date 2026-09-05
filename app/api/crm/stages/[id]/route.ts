import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { resolveMailboxOwnerId } from "@/lib/team-scope";
import { CRM_STAGE_SELECT } from "@/lib/crm-stages";

export const runtime = "nodejs";

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

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  const ctx = await requireBoardOwner(request);
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    description?: unknown;
    color?: unknown;
  };

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.name === "string") {
    const name = body.name.trim();
    if (!name) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    updates.name = name;
  }
  // description is nullable and clearing it is meaningful (the classifier then
  // has only the column name to go on), so an explicit empty string wipes it.
  if (typeof body.description === "string") updates.description = body.description.trim() || null;
  if (typeof body.color === "string") updates.color = body.color || null;

  const { data, error } = await ctx.supabase
    .from("crm_stages")
    .update(updates)
    .eq("id", params.id)
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .select(CRM_STAGE_SELECT)
    .maybeSingle();

  if (error) {
    const duplicate = /duplicate key|crm_stages_owner_name_key/i.test(error.message);
    return NextResponse.json(
      { error: duplicate ? "A column with that name already exists." : error.message },
      { status: duplicate ? 409 : 500 }
    );
  }
  if (!data) return NextResponse.json({ error: "Stage not found" }, { status: 404 });
  return NextResponse.json({ stage: data });
}

/**
 * Deleting a column must not delete the leads sitting in it — they are moved
 * to the board's "unsorted" column first. The FK is `on delete set null`, so
 * skipping this would strand cards with no stage at all instead of parking
 * them somewhere visible.
 */
export async function DELETE(request: Request, { params }: { params: { id: string } }) {
  const ctx = await requireBoardOwner(request);
  if ("error" in ctx) return ctx.error;

  const { data: stage } = await ctx.supabase
    .from("crm_stages")
    .select("id, is_unsorted")
    .eq("id", params.id)
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .maybeSingle();

  if (!stage) return NextResponse.json({ error: "Stage not found" }, { status: 404 });
  if (stage.is_unsorted) {
    return NextResponse.json(
      { error: "The unsorted column can't be deleted — it's where unplaced leads land." },
      { status: 400 }
    );
  }

  const { data: fallback } = await ctx.supabase
    .from("crm_stages")
    .select("id")
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .eq("is_unsorted", true)
    .maybeSingle();

  const { error: moveError } = await ctx.supabase
    .from("leads")
    .update({
      stage_id: fallback?.id ?? null,
      stage_set_by: "human",
      updated_at: new Date().toISOString(),
    })
    .eq("stage_id", params.id);
  if (moveError) return NextResponse.json({ error: moveError.message }, { status: 500 });

  const { error } = await ctx.supabase
    .from("crm_stages")
    .delete()
    .eq("id", params.id)
    .eq("mailbox_owner_id", ctx.mailboxOwnerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, movedTo: fallback?.id ?? null });
}
