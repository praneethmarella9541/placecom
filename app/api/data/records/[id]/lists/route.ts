import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { isUuid } from "@/lib/data-model/lists";

export const runtime = "nodejs";

/** GET /api/data/records/[id]/lists — every list this record is on, with its stage in each. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id } = await props.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data, error } = await svc
    .from("data_list_entries")
    .select("id, list_id, stage_id, stage_entered_at, list:data_lists!inner(id, name, archived_at), stage:data_list_stages(name, color)")
    .eq("org_owner_id", orgOwnerId)
    .eq("record_id", id)
    .is("list.archived_at", null);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });

  type Joined<T> = T | T[] | null;
  const one = <T,>(v: Joined<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : v);
  return NextResponse.json({
    memberships: (data ?? []).map((e) => {
      const list = one(e.list as Joined<{ id: string; name: string }>);
      const stage = one(e.stage as Joined<{ name: string; color: string | null }>);
      return {
        entry_id: e.id as string,
        list_id: e.list_id as string,
        list_name: list?.name ?? "List",
        stage_name: stage?.name ?? null,
        stage_color: stage?.color ?? null,
        stage_entered_at: e.stage_entered_at as string,
      };
    }),
  });
}
