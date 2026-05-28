import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listSpreadsheetsPage, createSpreadsheet, type SheetsView } from "@/lib/sheets";
import { SHEETS_INSUFFICIENT_SCOPE } from "@/lib/sheets-scope-error";

export const runtime = "nodejs";

const VALID_VIEWS: SheetsView[] = ["my-sheets", "shared-with-me", "starred"];

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get("pageToken") || undefined;
  const search = searchParams.get("search")?.trim() || undefined;
  const viewRaw = searchParams.get("view")?.trim() as SheetsView | null;
  const view: SheetsView | undefined =
    viewRaw && VALID_VIEWS.includes(viewRaw) ? viewRaw : undefined;
  const pageSize = Math.min(
    100,
    Math.max(5, parseInt(searchParams.get("pageSize") || "50", 10) || 50)
  );

  try {
    const page = await listSpreadsheetsPage(auth.accessToken, {
      pageSize,
      pageToken,
      search,
      view,
    });
    return NextResponse.json(
      { files: page.files, nextPageToken: page.nextPageToken },
      { headers: { "Cache-Control": "private, max-age=30, stale-while-revalidate=120" } }
    );
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === SHEETS_INSUFFICIENT_SCOPE || err.code === "DRIVE_INSUFFICIENT_SCOPE") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(e);
    return NextResponse.json(
      { error: err.message || "Failed to list spreadsheets" },
      { status: 500 }
    );
  }
}

type CreateBody = { title?: string };

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    body = {};
  }
  const title = (body.title ?? "").trim();
  if (title.length > 256) {
    return NextResponse.json({ error: "Title is too long (max 256)" }, { status: 400 });
  }

  try {
    const result = await createSpreadsheet(auth.accessToken, {
      title: title || "Untitled spreadsheet",
    });
    return NextResponse.json(result, { status: 201 });
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.code === SHEETS_INSUFFICIENT_SCOPE) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(e);
    return NextResponse.json(
      { error: err.message || "Failed to create spreadsheet" },
      { status: 500 }
    );
  }
}
