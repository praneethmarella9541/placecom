import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { objectAccess } from "@/lib/data-model/access";
import { withRecord } from "@/lib/data-model/route-helpers";
import type { AttributeConfig } from "@/lib/data-model/types";

export const runtime = "nodejs";

const MAX_PER_GROUP = 100;

/**
 * GET /api/data/records/[id]/related
 * Records that point AT this one through a link field: a company's people (People · Company), its
 * deals (Deals · Company), a person's deals. Found from the field definitions, so a custom link
 * field you add shows up here with no code change.
 */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
  const found = await withRecord(request, (await props.params).id, "read");
  if ("response" in found) return found.response;
  const { svc, orgOwnerId } = found.ctx;
  const { record, object } = found;

  const { data: attrs, error } = await svc
    .from("data_attributes")
    .select("slug, name, config, object_id")
    .eq("org_owner_id", orgOwnerId)
    .eq("type", "record_ref")
    .is("list_id", null)
    .is("archived_at", null);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });

  const pointing = (attrs ?? []).filter((a) => (a.config as AttributeConfig | null)?.target_object === object.slug);
  if (!pointing.length) return NextResponse.json({ groups: [] });

  const { data: objects } = await svc.from("data_objects").select("id, slug, plural_name, staff_access").eq("org_owner_id", orgOwnerId).in("id", [...new Set(pointing.map((a) => a.object_id as string))]);
  const byId = new Map((objects ?? []).map((o) => [o.id as string, o]));

  const groups = await Promise.all(
    pointing.map(async (a) => {
      const from = byId.get(a.object_id as string);
      if (!from || objectAccess(found.ctx, { staff_access: from.staff_access as "none" | "read" | "write" | undefined }) === "none") return null;
      const { data, count } = await svc
        .from("data_records")
        .select("id, name", { count: "exact" })
        .eq("org_owner_id", orgOwnerId)
        .eq("object_id", from.id)
        .is("deleted_at", null)
        .filter(`values->>${a.slug as string}`, "eq", record.id)
        .order("name", { ascending: true })
        .limit(MAX_PER_GROUP);
      return {
        object_slug: from.slug as string,
        object_name: from.plural_name as string,
        attribute_slug: a.slug as string,
        attribute_name: a.name as string,
        total: count ?? 0,
        records: (data ?? []) as { id: string; name: string }[],
      };
    })
  );
  return NextResponse.json({ groups: groups.filter((g): g is NonNullable<typeof g> => g !== null) });
}
