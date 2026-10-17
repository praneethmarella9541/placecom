import { NextResponse } from "next/server";

import { assertAdminUserId } from "@/lib/admin-auth";
import { startOfMonthIso } from "@/lib/integrations/lusha-spend";
import { createServiceSupabase } from "@/lib/supabase-service";

export const runtime = "nodejs";

export type LushaUsageRow = {
  userId: string | null;
  name: string;
  credits: number;
  reveals: number;
  searches: number;
};

/** GET /api/integrations/lusha/usage — who spent how many Lusha credits this month. Admin only. */
export async function GET(request: Request) {
  const admin = await assertAdminUserId(request);
  if ("error" in admin) return NextResponse.json({ error: admin.error }, { status: admin.status });
  const svc = createServiceSupabase();

  const { data } = await svc
    .from("contact_enrichments")
    .select("requested_by, kind, credits_charged")
    .eq("mailbox_owner_id", admin.userId)
    .gte("created_at", startOfMonthIso())
    .limit(20_000);

  const byUser = new Map<string, LushaUsageRow>();
  for (const r of (data ?? []) as { requested_by: string | null; kind: string; credits_charged: number }[]) {
    const key = r.requested_by ?? "unknown";
    const row = byUser.get(key) ?? { userId: r.requested_by, name: "Former team member", credits: 0, reveals: 0, searches: 0 };
    row.credits += r.credits_charged || 0;
    if (r.kind === "reveal") row.reveals += 1;
    else row.searches += 1;
    byUser.set(key, row);
  }

  const ids = Array.from(byUser.values()).map((r) => r.userId).filter((v): v is string => !!v);
  if (ids.length > 0) {
    const { data: profiles } = await svc.from("profiles").select("id, display_username").in("id", ids);
    for (const p of (profiles ?? []) as { id: string; display_username: string | null }[]) {
      const row = byUser.get(p.id);
      if (row) row.name = p.display_username?.trim() || "Team member";
    }
  }

  const rows = Array.from(byUser.values()).sort((a, b) => b.credits - a.credits);
  return NextResponse.json({
    month: startOfMonthIso(),
    totalCredits: rows.reduce((n, r) => n + r.credits, 0),
    rows,
  });
}
