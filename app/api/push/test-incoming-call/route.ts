import { NextResponse } from "next/server";
import { getUserOr401 } from "@/lib/request-auth";
import { sendTestIncomingCallPush } from "@/lib/push-notifications";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { user } = await getUserOr401(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let caller = "+919999999999";
  try {
    const body = (await request.json().catch(() => ({}))) as { caller?: string };
    if (body.caller?.trim()) caller = body.caller.trim();
  } catch {
    /* optional body */
  }

  try {
    const result = await sendTestIncomingCallPush(user.id, caller);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed" },
      { status: 500 }
    );
  }
}
