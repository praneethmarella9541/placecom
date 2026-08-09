import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { createBlankGoogleDoc, listGoogleDocsPage } from "@/lib/drive";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get("pageToken") || undefined;
  const search = searchParams.get("search")?.trim() || undefined;
  const pageSize = Math.min(
    50,
    Math.max(5, parseInt(searchParams.get("pageSize") || "30", 10) || 30)
  );

  try {
    const page = await listGoogleDocsPage(auth.accessToken, { pageSize, pageToken, search });

    return NextResponse.json(
      {
        docs: page.files,
        nextPageToken: page.nextPageToken,
        connectedEmail: auth.gmailAddress ?? null,
      },
      { headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=180" } }
    );
  } catch (e) {
    const err = e as Error & { code?: string };
    if (err.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(e);
    return NextResponse.json({ error: err.message || "Failed to list docs" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { title?: string };
  try {
    body = (await request.json()) as { title?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) {
    return NextResponse.json({ error: "title is required" }, { status: 400 });
  }

  try {
    const created = await createBlankGoogleDoc(auth.accessToken, title);
    return NextResponse.json({ documentId: created.id });
  } catch (e) {
    const err = e as Error & { status?: number; code?: string };
    if (err.status === 401 || err.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    console.error(e);
    return NextResponse.json({ error: err.message || "Failed to create doc" }, { status: 500 });
  }
}
