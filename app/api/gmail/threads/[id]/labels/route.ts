import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { modifyThreadLabels } from "@/lib/gmail-labels";
import { GMAIL_INSUFFICIENT_SCOPE } from "@/lib/gmail-scope-error";

export const runtime = "nodejs";

type ModifyBody = {
  add?: string[];
  remove?: string[];
};

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Missing thread id" }, { status: 400 });
  }

  let body: ModifyBody;
  try {
    body = (await request.json()) as ModifyBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const add = Array.isArray(body.add) ? body.add.filter((x) => typeof x === "string") : [];
  const remove = Array.isArray(body.remove) ? body.remove.filter((x) => typeof x === "string") : [];
  if (add.length === 0 && remove.length === 0) {
    return NextResponse.json({ error: "Pass at least one label id to add or remove" }, { status: 400 });
  }

  try {
    const result = await modifyThreadLabels(auth.accessToken, id, { add, remove }, { mailboxKey: auth.mailboxOwnerId });
    return NextResponse.json({ threadId: id, labelIds: result.labelIds });
  } catch (e) {
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
      { error: err.message || "Failed to update labels" },
      { status: 500 }
    );
  }
}
