import "server-only";

import { NextResponse } from "next/server";
import { requireDataContext, type DataContext } from "@/lib/data-model/access";
import { loadModuleConfig } from "@/lib/module-config-store";
import { isModuleEnabled } from "@/lib/module-config";

/**
 * Who may use workflows. Version 1: admins build, publish, run and read runs. A workflow acts as an
 * admin (its owner), so it can only be given to an admin; letting staff build workflows needs the
 * per-workflow write grants in the brief (section 8) and is not here yet.
 *
 * Switched by the `workflows` module on top of the `dataModel` one: with either off, a 404.
 */
export type WorkflowContextResult = { ok: true; ctx: DataContext } | { ok: false; response: NextResponse };

export async function requireWorkflowContext(request: Request, need: "read" | "admin" = "admin"): Promise<WorkflowContextResult> {
  const auth = await requireDataContext(request, need === "admin" ? "admin" : "read");
  if (!auth.ok) return auth;
  if (!isModuleEnabled(await loadModuleConfig(auth.ctx.svc), "workflows")) return { ok: false, response: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  return auth;
}

export function missingWorkflowTables(message: string | undefined): NextResponse | null {
  if (message && /relation .*workflow.* does not exist|could not find the table|schema cache/i.test(message)) {
    return NextResponse.json({ error: "Workflows aren't set up on this database yet (migration 0094)." }, { status: 503 });
  }
  return null;
}
