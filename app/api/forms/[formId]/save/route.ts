import { NextResponse } from "next/server";
import { batchUpdateGoogleForm, getGoogleForm } from "@/lib/google-forms";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  buildBatchUpdateRequests,
  type EditorState,
  googleFormToEditorState,
} from "@/lib/google-forms-editor-model";

export const runtime = "nodejs";

function insufficientFormsScope(body: string): boolean {
  return (
    body.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    (body.includes("insufficientPermissions") && body.includes("forms.googleapis.com"))
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ formId: string }> }
) {
  const auth = await requireGmailAccessToken();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { formId } = await context.params;
  const id = formId?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing form id" }, { status: 400 });
  }

  let body: { state?: EditorState };
  try {
    body = (await request.json()) as { state?: EditorState };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const state = body.state;
  if (!state || typeof state !== "object") {
    return NextResponse.json({ error: "state is required" }, { status: 400 });
  }

  try {
    const prev = await getGoogleForm(auth.accessToken, id);
    const { requests, writeControl } = buildBatchUpdateRequests(prev, state);

    if (requests.length === 0) {
      return NextResponse.json({
        ok: true,
        form: prev,
        editorState: googleFormToEditorState(prev),
        noChanges: true,
      });
    }

    const payload: Record<string, unknown> = {
      includeFormInResponse: true,
      requests,
    };
    if (writeControl) payload.writeControl = writeControl;

    const updated = await batchUpdateGoogleForm(auth.accessToken, id, payload);
    const form =
      (updated.form as Record<string, unknown> | undefined) ||
      (await getGoogleForm(auth.accessToken, id));

    return NextResponse.json({
      ok: true,
      form,
      editorState: googleFormToEditorState(form),
    });
  } catch (e) {
    const err = e as Error & { status?: number; body?: string; code?: string };
    const raw = err.body || err.message || "";
    if (raw.includes("revision") || raw.includes("WriteControl")) {
      return NextResponse.json(
        {
          error: "FORM_REVISION_CONFLICT",
          message:
            "This form changed elsewhere. Refresh the page and try saving again.",
        },
        { status: 409 }
      );
    }
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
    console.error(e);
    return NextResponse.json(
      { error: err.message || "Failed to save form" },
      { status: 500 }
    );
  }
}
