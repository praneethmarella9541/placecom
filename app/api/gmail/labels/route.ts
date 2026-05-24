import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { createLabel, listLabels, type GmailLabel } from "@/lib/gmail-labels";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";

function errResponse(e: unknown) {
  const err = e as Error & { code?: string };
  if (err.code === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
  }
  if (err.code === GMAIL_INSUFFICIENT_SCOPE) {
    return NextResponse.json(
      { error: GMAIL_INSUFFICIENT_SCOPE, message: err.message },
      { status: 403 }
    );
  }
  return NextResponse.json(
    { error: err.message || "Gmail labels request failed" },
    { status: 500 }
  );
}

export async function GET(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  try {
    const labels = await listLabels(auth.accessToken);
    // Sort: user labels first (alpha), then surfaced system labels.
    const sorted = labels.slice().sort((a, b) => {
      if (a.type !== b.type) return a.type === "user" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return NextResponse.json(
      { labels: sorted },
      {
        // Labels change rarely — let the browser cache for a minute and
        // serve stale for five while we revalidate.
        headers: { "Cache-Control": "private, max-age=60, stale-while-revalidate=300" },
      }
    );
  } catch (e) {
    return errResponse(e);
  }
}

type CreateBody = {
  name?: string;
  color?: { textColor: string; backgroundColor: string };
};

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Label name is required" }, { status: 400 });
  }
  // Gmail accepts up to 225 chars, but anything past 60 is unreadable in chips.
  if (name.length > 100) {
    return NextResponse.json({ error: "Label name is too long (max 100)" }, { status: 400 });
  }
  try {
    const label: GmailLabel = await createLabel(auth.accessToken, {
      name,
      color: body.color,
    });
    return NextResponse.json({ label }, { status: 201 });
  } catch (e) {
    return errResponse(e);
  }
}
