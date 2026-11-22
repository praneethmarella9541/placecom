import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";
import { isUuid } from "@/lib/data-model/lists";
import { loadAttributes } from "@/lib/data-model/records";
import { apiNameTaken, validateFormulaRule } from "@/lib/data-model/rule-formula-validate";
import { snapshotRuleVersion } from "@/lib/data-model/rule-audit";

export const runtime = "nodejs";

const FORMULA_FIELDS = ["apiName", "description", "appliesOn", "mode", "errorLocation", "message", "expressionSource"] as const;

/**
 * PATCH /api/data/rules/[id] (admin)
 *   { active?, name?, order? } — any rule.
 *   { apiName?, description?, appliesOn?, mode?, errorLocation?, message?, expressionSource? } —
 *   formula rules only; a touched field is re-validated and re-compiled together with whatever of
 *   these fields were left out (merged from the stored row), since a formula is one shape, not a set
 *   of independent fields that can go half-updated. Bumps `version`.
 */
export async function PATCH(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId, userId } = auth.ctx;
  const { id } = await props.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });

  const { data: existing } = await svc
    .from("data_validation_rules")
    .select(
      "id, object_id, name, kind, active, order_index, admin_bypass, condition, requirements, format, version, api_name, description, applies_on, mode, error_location, message, expression_source"
    )
    .eq("org_owner_id", orgOwnerId)
    .eq("id", id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const patch: Record<string, unknown> = {};
  if (body.active !== undefined) patch.active = body.active === true;
  if (body.name !== undefined) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 100) return NextResponse.json({ error: "Name must be 1 to 100 characters." }, { status: 400 });
    patch.name = name;
  }
  if (body.order !== undefined) {
    const n = Number(body.order);
    if (!Number.isFinite(n)) return NextResponse.json({ error: "order must be a number." }, { status: 400 });
    patch.order_index = Math.trunc(n);
  }
  if (body.adminBypass !== undefined) patch.admin_bypass = body.adminBypass === true;

  if (FORMULA_FIELDS.some((k) => body[k] !== undefined)) {
    if (existing.format !== "formula") return NextResponse.json({ error: "Only a formula rule can be edited this way." }, { status: 400 });
    const merged = {
      apiName: body.apiName !== undefined ? body.apiName : existing.api_name,
      description: body.description !== undefined ? body.description : existing.description,
      appliesOn: body.appliesOn !== undefined ? body.appliesOn : existing.applies_on,
      mode: body.mode !== undefined ? body.mode : existing.mode,
      errorLocation: body.errorLocation !== undefined ? body.errorLocation : existing.error_location,
      message: body.message !== undefined ? body.message : existing.message,
      expressionSource: body.expressionSource !== undefined ? body.expressionSource : existing.expression_source,
    };
    const attrs = await loadAttributes(svc, orgOwnerId, existing.object_id as string);
    const validated = await validateFormulaRule(svc, orgOwnerId, attrs, merged);
    if (!validated.ok) return NextResponse.json({ error: validated.error, pos: validated.pos }, { status: 400 });
    if (validated.row.api_name !== existing.api_name && (await apiNameTaken(svc, orgOwnerId, existing.object_id as string, validated.row.api_name, id))) {
      return NextResponse.json({ error: `"${validated.row.api_name}" is already used by another rule on this object.` }, { status: 409 });
    }
    const { format: _format, ...formulaPatch } = validated.row;
    void _format; // format itself never changes via PATCH — this row was already 'formula'
    Object.assign(patch, formulaPatch);
    const currentVersion = typeof existing.version === "number" ? existing.version : 1;
    patch.version = currentVersion + 1;
    // Snapshot the rule exactly as it reads right now, filed under the version number it's about
    // to stop being. Best effort — never blocks the edit it's a record of.
    await snapshotRuleVersion(svc, orgOwnerId, id, currentVersion, existing as unknown as Record<string, unknown>, userId);
  }

  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
  patch.updated_at = new Date().toISOString();
  patch.updated_by = userId;

  const { data, error } = await svc.from("data_validation_rules").update(patch).eq("org_owner_id", orgOwnerId).eq("id", id).select("id").maybeSingle();
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** DELETE /api/data/rules/[id] (admin) — removes the rule; no record is touched. */
export async function DELETE(request: Request, props: { params: Promise<{ id: string }> }) {
  const auth = await requireDataContext(request, "admin");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;
  const { id } = await props.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const { error } = await svc.from("data_validation_rules").delete().eq("org_owner_id", orgOwnerId).eq("id", id);
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({ ok: true });
}
