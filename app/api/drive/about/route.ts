import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

const DRIVE_API = "https://www.googleapis.com/drive/v3";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const res = await fetch(`${DRIVE_API}/about?fields=storageQuota`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });

  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Drive API ${res.status}: ${text}` }, { status: res.status });
  }

  const data = (await res.json()) as {
    storageQuota?: {
      limit?: string;
      usage?: string;
      usageInDrive?: string;
      usageInDriveTrash?: string;
    };
  };

  return NextResponse.json(data.storageQuota ?? {}, { headers: { "Cache-Control": "no-store" } });
}
