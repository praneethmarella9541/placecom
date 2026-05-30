import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { deleteLabel, updateLabel } from "@/lib/gmail-labels";
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
    { error: err.message || "Gmail label request failed" },
    { status: 500 }
  );
}

type PatchBody = { name?: string };

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing label id" }, { status: 400 });
  }

  let body: PatchBody;
  try {
    body = (await request.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json({ error: "Label name is required" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "Label name is too long (max 100)" }, { status: 400 });
  }

  try {
    const label = await updateLabel(auth.accessToken, id, { name });
    return NextResponse.json({ label });
  } catch (e) {
    return errResponse(e);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing label id" }, { status: 400 });
  }

  try {
    await deleteLabel(auth.accessToken, id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
