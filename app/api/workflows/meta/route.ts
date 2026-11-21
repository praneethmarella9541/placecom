import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireWorkflowContext } from "@/lib/workflows/access";

export const runtime = "nodejs";

/**
 * GET /api/workflows/meta — what the builder needs to offer choices, in one request: the objects
 * with their fields, the lists with their stages, and the admins a workflow can act as and the team
 * members it can address.
 */
export async function GET(request: Request) {
  const auth = await requireWorkflowContext(request);
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const [objects, attrs, lists, stages, people] = await Promise.all([
    svc.from("data_objects").select("id, slug, singular_name, plural_name").eq("org_owner_id", orgOwnerId).order("position", { ascending: true }),
    svc.from("data_attributes").select("object_id, slug, name, type, is_multi, config").eq("org_owner_id", orgOwnerId).is("list_id", null).is("archived_at", null).order("position", { ascending: true }),
    svc.from("data_lists").select("id, name, object_id, has_stages").eq("org_owner_id", orgOwnerId).is("archived_at", null).order("name", { ascending: true }),
    svc.from("data_list_stages").select("id, list_id, name").eq("org_owner_id", orgOwnerId).order("position", { ascending: true }),
    svc.from("profiles").select("id, display_username, role").or(`id.eq.${orgOwnerId},mailbox_owner_id.eq.${orgOwnerId}`).order("display_username", { ascending: true }),
  ]);
  const failed = [objects, attrs, lists, stages, people].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: dbErrorMessage(failed.error) }, { status: 500 });

  const slugOf = new Map((objects.data ?? []).map((o) => [o.id as string, o.slug as string]));
  return NextResponse.json({
    objects: (objects.data ?? []).map((o) => ({
      slug: o.slug,
      singular_name: o.singular_name,
      plural_name: o.plural_name,
      attributes: (attrs.data ?? []).filter((a) => a.object_id === o.id).map((a) => ({ slug: a.slug, name: a.name, type: a.type, is_multi: a.is_multi, config: a.config })),
    })),
    lists: (lists.data ?? []).map((l) => ({ id: l.id, name: l.name, object_slug: slugOf.get(l.object_id as string) ?? null, has_stages: l.has_stages, stages: (stages.data ?? []).filter((s) => s.list_id === l.id).map((s) => ({ id: s.id, name: s.name })) })),
    members: (people.data ?? []).map((p) => ({ id: p.id, name: ((p.display_username as string | null) ?? "").trim() || "Unnamed", is_admin: p.role === "admin" })),
  });
}
