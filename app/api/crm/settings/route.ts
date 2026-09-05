import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { resolveMailboxOwnerId } from "@/lib/team-scope";
import { CRM_MODELS, DEFAULT_CRM_SETTINGS, type CrmSettings } from "@/lib/crm-settings";

export const runtime = "nodejs";

const SELECT = "season_start_date, model, confidence_threshold";

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

  const { data, error } = await ctx.supabase
    .from("crm_settings")
    .select(SELECT)
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .maybeSingle();

  // Before migration 0054 the table doesn't exist — fall back to defaults so
  // the board renders its own "apply the migration" notice once, from the
  // stages call, instead of erroring twice.
  if (error) {
    if (/relation .*crm_settings.* does not exist|could not find the table/i.test(error.message)) {
      return NextResponse.json({ settings: DEFAULT_CRM_SETTINGS, configured: false });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  // No row yet just means "never configured" — hand back the defaults rather
  // than a null the client has to special-case.
  return NextResponse.json({
    settings: (data as CrmSettings | null) ?? DEFAULT_CRM_SETTINGS,
    configured: Boolean(data),
  });
}

export async function PATCH(request: Request) {
  const ctx = await requireBoardOwner(request);
  if ("error" in ctx) return ctx.error;

  const body = (await request.json().catch(() => ({}))) as {
    season_start_date?: unknown;
    model?: unknown;
    confidence_threshold?: unknown;
  };

  const updates: Record<string, unknown> = {};

  if (body.season_start_date !== undefined) {
    const raw = body.season_start_date;
    if (raw === null || raw === "") {
      updates.season_start_date = null;
    } else if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      updates.season_start_date = raw;
    } else {
      return NextResponse.json(
        { error: "season_start_date must be YYYY-MM-DD or null" },
        { status: 400 }
      );
    }
  }

  if (body.model !== undefined) {
    if (typeof body.model !== "string" || !CRM_MODELS.some((m) => m.id === body.model)) {
      return NextResponse.json({ error: "Unsupported model" }, { status: 400 });
    }
    updates.model = body.model;
  }

  if (body.confidence_threshold !== undefined) {
    const n = Number(body.confidence_threshold);
    if (!Number.isFinite(n) || n < 0 || n > 1) {
      return NextResponse.json(
        { error: "confidence_threshold must be between 0 and 1" },
        { status: 400 }
      );
    }
    updates.confidence_threshold = Number(n.toFixed(2));
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  // Merge onto whatever is already stored, not onto the defaults — a PATCH of
  // one field must not silently reset the others (upsert writes whole rows).
  const { data: existing } = await ctx.supabase
    .from("crm_settings")
    .select(SELECT)
    .eq("mailbox_owner_id", ctx.mailboxOwnerId)
    .maybeSingle();

  const { data, error } = await ctx.supabase
    .from("crm_settings")
    .upsert(
      {
        mailbox_owner_id: ctx.mailboxOwnerId,
        ...DEFAULT_CRM_SETTINGS,
        ...(existing ?? {}),
        ...updates,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "mailbox_owner_id" }
    )
    .select(SELECT)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data, configured: true });
}
