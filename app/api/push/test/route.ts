import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { sendTestPushToUser } from "@/lib/push-notifications";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const result = await sendTestPushToUser(user.id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
