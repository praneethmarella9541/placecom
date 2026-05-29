import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

const FORMS_API = "https://forms.googleapis.com/v1";

type Params = { params: Promise<{ formId: string; responseId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) return NextResponse.json({ error: auth.message }, { status: auth.status });

  const { formId, responseId } = await params;
  if (!formId?.trim() || !responseId?.trim()) {
    return NextResponse.json({ error: "Missing formId or responseId" }, { status: 400 });
  }

  const res = await fetch(
    `${FORMS_API}/forms/${encodeURIComponent(formId)}/responses/${encodeURIComponent(responseId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${auth.accessToken}` } }
  );

  if (res.status === 401) return NextResponse.json({ error: "Token expired. Sign in again." }, { status: 401 });
  if (res.status === 404) return NextResponse.json({ error: "Response not found" }, { status: 404 });
  if (!res.ok) {
    const text = await res.text();
    return NextResponse.json({ error: `Forms API ${res.status}: ${text}` }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
