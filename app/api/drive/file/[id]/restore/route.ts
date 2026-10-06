import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { deleteForbiddenResponse } from "@/lib/delete-access";
import { restoreDriveFile } from "@/lib/drive";

export const runtime = "nodejs";

/** POST — restore a file or folder from Drive's trash. Gated with the rest of delete. */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const forbidden = await deleteForbiddenResponse();
  if (forbidden) return forbidden;

  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const fileId = params.id?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "Missing file id" }, { status: 400 });
  }
  try {
    await restoreDriveFile(auth.accessToken, fileId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const err = e as Error & { status?: number };
    return NextResponse.json(
      { error: err.message || "Could not restore" },
      { status: err.status && err.status >= 400 ? err.status : 500 }
    );
  }
}
