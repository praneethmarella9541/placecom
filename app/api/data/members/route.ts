import { NextResponse } from "next/server";
import { dbErrorMessage } from "@/lib/api-error";
import { requireDataContext } from "@/lib/data-model/access";

export const runtime = "nodejs";

/** GET /api/data/members — the people on this org's team, for "member" attributes (a deal's owner). */
export async function GET(request: Request) {
  const auth = await requireDataContext(request, "read");
  if (!auth.ok) return auth.response;
  const { svc, orgOwnerId } = auth.ctx;

  const { data, error } = await svc
    .from("profiles")
    .select("id, display_username")
    .or(`id.eq.${orgOwnerId},mailbox_owner_id.eq.${orgOwnerId}`)
    .order("display_username", { ascending: true });
  if (error) return NextResponse.json({ error: dbErrorMessage(error) }, { status: 500 });
  return NextResponse.json({
    members: (data ?? []).map((m) => ({ id: m.id as string, name: ((m.display_username as string | null) ?? "").trim() || "Unnamed" })),
  });
}
