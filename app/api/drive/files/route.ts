import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listDriveFilesPage } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get("pageToken") || undefined;
  const search = searchParams.get("search")?.trim() || undefined;
  const parentRaw = searchParams.get("parent")?.trim();
  const parentId = parentRaw && parentRaw.length > 0 ? parentRaw : "root";
  const pageSize = Math.min(
    50,
    Math.max(5, parseInt(searchParams.get("pageSize") || "30", 10) || 30)
  );

  try {
    const page = await listDriveFilesPage(auth.accessToken, {
      pageSize,
      pageToken,
      search,
      parentId,
    });
    return NextResponse.json({
      files: page.files,
      nextPageToken: page.nextPageToken,
    });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(e);
    return NextResponse.json(
      { error: err.message || "Failed to list Drive files" },
      { status: 500 }
    );
  }
}
