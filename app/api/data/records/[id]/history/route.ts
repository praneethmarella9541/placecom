import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** GET /api/data/records/[id]/history — the 100 most recent changes, newest first, with who made them. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data, error } = await svc
    .from("data_record_history")
    .select("id, attribute_slug, action, old_value, new_value, actor_id, source, created_at")
    .eq("org_owner_id", orgOwnerId)
    .eq("record_id", id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });

  const actorIds = [...new Set((data ?? []).map((h) => h.actor_id as string | null).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (actorIds.length) {
    const { data: people } = await svc.from("profiles").select("id, display_username").in("id", actorIds);
    for (const p of people ?? []) names.set(p.id as string, ((p.display_username as string | null) ?? "").trim() || "A teammate");
  }
  return NextResponse.json({
    history: (data ?? []).map((h) => ({ ...h, actor_name: h.actor_id ? (names.get(h.actor_id as string) ?? "A teammate") : "System" })),
  });
}
