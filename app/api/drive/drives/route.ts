import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listSharedDrives } from "@/lib/drive";

export const runtime = "nodejs";

/** GET — list the shared drives the user has access to. */
export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  try {
    const drives = await listSharedDrives(auth.accessToken);
    return NextResponse.json(
      { drives },
      // Shared drives change rarely — let the browser hold for a minute.
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" } }
    );
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
      return NextResponse.json(
        {
          error: "DRIVE_INSUFFICIENT_SCOPE",
          message:
            "Listing shared drives requires the full Drive scope. Sign out and sign in again to grant it.",
        },
        { status: 403 }
      );
    }
    return NextResponse.json(
      { error: err.message || "Failed to list shared drives" },
      { status: 500 }
    );
  }
}
