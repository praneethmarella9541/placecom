import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";

export const runtime = "nodejs";

/**
 * WhatsApp group management requires Meta OBA + Groups API on your WABA.
 * Exotel documents individual sends today; this endpoint reserves the API surface.
 */
export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = (await request.json().catch(() => null)) as { name?: string; memberPhones?: string[] } | null;
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: "Group name is required" }, { status: 400 });
  }

  return NextResponse.json(
    {
      error:
        "WhatsApp group creation is not enabled for this account yet. Meta requires an Official Business Account, high messaging limits, and Groups API approval (max 8 members per group). Contact Exotel to enable groups on your WABA, then we can wire group_id sends.",
      code: "WHATSAPP_GROUPS_NOT_AVAILABLE",
      docs: "https://developers.facebook.com/documentation/business-messaging/whatsapp/groups",
    },
    { status: 501 }
  );
}

export async function GET() {
  return NextResponse.json({
    groups: [],
    note: "Group list will appear here after Meta/Exotel enables Groups API on your business line.",
  });
}
