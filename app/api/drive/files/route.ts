import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  listDriveFilesPage,
  DRIVE_MIME_CATEGORIES,
  type DriveView,
  type DriveMimeCategory,
} from "@/lib/drive";

export const runtime = "nodejs";

const VALID_VIEWS: DriveView[] = ["my-drive", "shared-with-me", "starred", "recent"];

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get("pageToken") || undefined;
  const search = searchParams.get("search")?.trim() || undefined;
  const parentRaw = searchParams.get("parent")?.trim();
  const parentId = parentRaw && parentRaw.length > 0 ? parentRaw : "root";
  const viewRaw = searchParams.get("view")?.trim() as DriveView | null;
  const view: DriveView | undefined =
    viewRaw && VALID_VIEWS.includes(viewRaw) ? viewRaw : undefined;
  // Allow up to 100 when a mimeType filter is supplied (e.g. folder-only
  // requests from the Move modal) — the filtered set is much smaller so
  // a larger page is still fast. Default cap is 50 for mixed listings.
  const mimeTypeFilter = searchParams.get("mimeType")?.trim() || undefined;
  const mimeCategoryRaw = searchParams.get("mimeCategory")?.trim() as
    | DriveMimeCategory
    | null;
  const mimeCategory: DriveMimeCategory | undefined =
    mimeCategoryRaw && DRIVE_MIME_CATEGORIES.includes(mimeCategoryRaw)
      ? mimeCategoryRaw
      : undefined;
  const sharedDriveId = searchParams.get("sharedDriveId")?.trim() || undefined;
  const orderBy = searchParams.get("orderBy")?.trim() || undefined;
  const maxPageSize = 100;
  const pageSize = Math.min(
    maxPageSize,
    Math.max(5, parseInt(searchParams.get("pageSize") || "100", 10) || 100)
  );

  try {
    const page = await listDriveFilesPage(auth.accessToken, {
      pageSize,
      pageToken,
      search,
      parentId,
      view,
      mimeTypeFilter,
      mimeCategory,
      sharedDriveId,
      orderBy,
    });
    return NextResponse.json(
      { files: page.files, nextPageToken: page.nextPageToken },
      {
        headers: {
          "Cache-Control": search
            ? "private, no-store"
            : "private, max-age=60, stale-while-revalidate=300",
        },
      }
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
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(e);
    return NextResponse.json(
      { error: err.message || "Failed to list Drive files" },
      { status: 500 }
    );
  }
}
