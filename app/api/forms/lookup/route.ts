import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { getGoogleForm, parseGoogleFormIdFromInput } from "@/lib/google-forms";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  let body: { input?: string };
  try {
    body = (await request.json()) as { input?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const formId = parseGoogleFormIdFromInput(body.input ?? "");
  if (!formId) {
    return NextResponse.json(
      {
        error:
          "Paste a Google Form link (docs.google.com/forms/d/…) or the form ID from the URL.",
      },
      { status: 400 }
    );
  }

  try {
    const form = await getGoogleForm(auth.accessToken, formId);
    const title =
      typeof (form.info as { title?: string } | undefined)?.title === "string"
        ? ((form.info as { title: string }).title || "Untitled form")
        : "Untitled form";
    return NextResponse.json({ formId, title });
  } catch (e) {
    const err = e as Error & { status?: number; body?: string };
    if (err.status === 404) {
      return NextResponse.json(
        {
          error:
            "Form not found or you do not have access. It must belong to the connected Google account.",
        },
        { status: 404 }
      );
    }
    if (err.status === 401) {
      return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
    }
    if (err.status === 403) {
      return NextResponse.json(
        {
          error: "FORMS_INSUFFICIENT_SCOPE",
          message:
            "Google Forms access was not granted. Sign out and sign in with Google again to sync forms.",
        },
        { status: 403 }
      );
    }
    console.error("[forms/lookup]", e);
    return NextResponse.json({ error: err.message || "Failed to open form" }, { status: 500 });
  }
}
