import { NextResponse } from "next/server";
import { createGoogleForm, getGoogleForm, publishGoogleForm } from "@/lib/google-forms";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { listGoogleFormsPage, type DriveFileRow } from "@/lib/drive";

export const runtime = "nodejs";

async function attachFormTitles(
  accessToken: string,
  files: DriveFileRow[]
): Promise<(DriveFileRow & { formTitle: string | null })[]> {
  return Promise.all(
    files.map(async (f) => {
      try {
        const form = await getGoogleForm(accessToken, f.id);
        const info = form.info as { title?: string } | undefined;
        const t = typeof info?.title === "string" ? info.title.trim() : "";
        return { ...f, formTitle: t || null };
      } catch {
        return { ...f, formTitle: null };
      }
    })
  );
}

function insufficientFormsScope(body: string): boolean {
  return (
    body.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    (body.includes("insufficientPermissions") && body.includes("forms.googleapis.com"))
  );
}

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
    const page = await listGoogleFormsPage(auth.accessToken, {
      pageSize,
      pageToken,
      search,
    });
    const forms = await attachFormTitles(auth.accessToken, page.files);
    return NextResponse.json({
      forms,
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
      { error: err.message || "Failed to list forms" },
      { status: 500 }
    );
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
    const created = await createGoogleForm(auth.accessToken, { title });
    // Publish the form so the responderUri actually opens (unpublished forms 404).
    let publishedResponderUri: string | undefined;
    try {
      await publishGoogleForm(auth.accessToken, created.formId);
      // Re-fetch — Google rewrites responderUri to the /d/e/{publishedId}/viewform
      // public form URL only after publish. The URL from create points to the
      // edit-style /d/{formId}/viewform which doesn't render for end users.
      const fresh = await getGoogleForm(auth.accessToken, created.formId);
      if (typeof fresh.responderUri === "string") {
        publishedResponderUri = fresh.responderUri;
      }
    } catch (pubErr) {
      console.warn("[forms] publish on create failed:", (pubErr as Error).message);
    }
    return NextResponse.json({
      formId: created.formId,
      responderUri: publishedResponderUri ?? created.responderUri,
    });
  } catch (e) {
    const err = e as Error & { status?: number; body?: string; code?: string };
    const raw = err.body || err.message || "";
    if (err.status === 403 && insufficientFormsScope(raw)) {
      return NextResponse.json(
        {
          error: "FORMS_INSUFFICIENT_SCOPE",
          message:
            "Google Forms access was not granted. Enable the Google Forms API and scope https://www.googleapis.com/auth/forms.body; then sign out and sign in with Google again.",
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
      { error: err.message || "Failed to create form" },
      { status: 500 }
    );
  }
}
