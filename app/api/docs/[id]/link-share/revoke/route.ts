import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { deleteFilePermission } from "@/lib/drive";

export const runtime = "nodejs";

/**
 * POST-only twin of `DELETE /api/docs/[id]/link-share`, for the
 * `navigator.sendBeacon` path on tab/browser close — beacons can only send
 * POST, and (unlike a normal unmount) can't await a response, so this just
 * fires the same revoke. See app/(workspace)/docs/[id]/page.tsx.
 */
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const { id } = await context.params;
  const documentId = id?.trim();
  if (!documentId) {
    return NextResponse.json({ error: "Missing document id" }, { status: 400 });
  }

  let body: { permissionId?: string };
  try {
    body = (await request.json()) as { permissionId?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const permissionId = body.permissionId?.trim();
  if (!permissionId) {
    return NextResponse.json({ error: "permissionId is required" }, { status: 400 });
  }

  try {
    await deleteFilePermission(auth.accessToken, documentId, permissionId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    // No client ever reads this response — sendBeacon is fire-and-forget —
    // so this is purely for server-side diagnostics, not user-facing.
    const err = e as Error & { code?: string };
    console.error(`[link-share/revoke] ${documentId}: ${err.code || err.message}`);
    return NextResponse.json({ error: "Failed to revoke link sharing" }, { status: 500 });
  }
}
