import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

const FORMS_API = "https://forms.googleapis.com/v1";

type Params = { params: Promise<{ formId: string }> };

export async function GET(request: Request, { params }: Params) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { formId } = await params;
  if (!formId?.trim()) return NextResponse.json({ error: "Missing formId" }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const pageToken = searchParams.get("pageToken") || undefined;
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50));

  const qs = new URLSearchParams({ pageSize: String(pageSize) });
  if (pageToken) qs.set("pageToken", pageToken);

  const res = await fetch(`${FORMS_API}/forms/${encodeURIComponent(formId)}/responses?${qs}`, {
    headers: { Authorization: `Bearer ${auth.accessToken}` },
  });

  if (res.status === 401) return NextResponse.json({ error: "Token expired. Sign in again." }, { status: 401 });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 403) {
      return NextResponse.json(
        { error: "FORMS_INSUFFICIENT_SCOPE", message: "Forms responses access not granted. Sign out and sign in again." },
        { status: 403 }
      );
    }
    return NextResponse.json({ error: `Forms API ${res.status}: ${text}` }, { status: 502 });
  }

  const data = await res.json();
  return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
}
