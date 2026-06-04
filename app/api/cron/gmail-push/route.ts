import { NextResponse } from "next/server";
import { runGmailPushCron } from "@/lib/push-notifications";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vercel Cron: poll Gmail history and send Expo push for new inbox mail. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret) {
    const auth = request.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    const result = await runGmailPushCron();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[cron/gmail-push]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Cron failed" },
      { status: 500 }
    );
  }
}
