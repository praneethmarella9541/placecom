import { NextResponse } from "next/server";
import { getGoogleForm } from "@/lib/google-forms";
import { requireGmailAccessToken } from "@/lib/gmail-auth";

export const runtime = "nodejs";

function insufficientFormsScope(body: string): boolean {
  return (
    body.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    (body.includes("insufficientPermissions") && body.includes("forms.googleapis.com"))
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ formId: string }> }
) {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { formId } = await context.params;
  if (!formId?.trim()) {
    return NextResponse.json({ error: "Missing form id" }, { status: 400 });
  }

  try {
    const form = await getGoogleForm(auth.accessToken, formId.trim());
    return NextResponse.json(form);
  } catch (e) {
    const err = e as Error & { status?: number; body?: string; code?: string };
    const raw = err.body || err.message || "";
    if (err.status === 403 && insufficientFormsScope(raw)) {
      return NextResponse.json(
        {
          error: "FORMS_INSUFFICIENT_SCOPE",
          message:
            "Google Forms access was not granted. Enable the Forms API and forms.body scope; sign out and sign in again.",
        },
        { status: 403 }
      );
    }
    if (err.status === 401 || err.code === "UNAUTHORIZED") {
      return NextResponse.json(
        { error: "Google token expired. Sign in again." },
        { status: 401 }
      );
    }
    if (err.status === 404) {
      return NextResponse.json({ error: "Form not found" }, { status: 404 });
    }
    console.error(e);
    return NextResponse.json(
      { error: err.message || "Failed to load form" },
      { status: 500 }
    );
  }
}
