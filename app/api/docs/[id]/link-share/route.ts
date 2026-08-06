import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import { addFilePermission, deleteFilePermission, listFilePermissions } from "@/lib/drive";

export const runtime = "nodejs";

/**
 * Grants/revokes "anyone with the link can edit" sharing on a Doc file,
 * scoped to how long the /docs tab for it stays open — the iframe-embedded
 * real Google Docs editor only works without a signed-in Google session
 * in-browser when the file allows anonymous link editing. Mirrors
 * app/api/sheets/[id]/link-share/route.ts exactly — see there for the
 * grant-on-mount / revoke-on-leave lifecycle this pairs with.
 */

function errorResponse(e: unknown, fallback: string, documentId: string) {
  const err = e as Error & { status?: number; code?: string };
  if (err.code === "UNAUTHORIZED") {
    return NextResponse.json({ error: "Google token expired. Sign in again." }, { status: 401 });
  }
  if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
    return NextResponse.json({ error: err.message }, { status: 403 });
  }
  if (err.code === "DRIVE_NO_SHARE_PERMISSION") {
    // The connected account can view/edit this file but isn't its owner
    // (or wasn't given "can manage sharing" rights) — Google blocks
    // sharing changes from anyone else. The in-app editor specifically
    // needs to change sharing (grant anonymous link-editing), so this
    // file can't be opened here until that's true.
    return NextResponse.json(
      {
        error: "DRIVE_NO_SHARE_PERMISSION",
        message:
          "This doc is shared with the connected account, but only its owner (or someone they've given sharing rights to) can change who has access — which this editor needs to do. Ask the owner to either share it as \"Anyone with the link can edit,\" or give the connected account permission to manage sharing.",
        webViewLink: `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/edit`,
      },
      { status: 403 }
    );
  }
  console.error(e);
  return NextResponse.json({ error: err.message || fallback }, { status: 500 });
}

/** POST — grant anyone-with-link edit access, unless the file already has it (then leave it alone). */
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

  try {
    const existing = await listFilePermissions(auth.accessToken, documentId);
    const alreadyShared = existing.some((p) => p.type === "anyone");
    if (alreadyShared) {
      return NextResponse.json({ granted: false, alreadyShared: true });
    }

    const permission = await addFilePermission(auth.accessToken, documentId, {
      role: "writer",
      type: "anyone",
    });
    return NextResponse.json({ granted: true, alreadyShared: false, permissionId: permission.id });
  } catch (e) {
    return errorResponse(e, "Failed to grant link sharing", documentId);
  }
}

/** DELETE — revoke a permission this endpoint granted (body: { permissionId }). */
export async function DELETE(
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
    return errorResponse(e, "Failed to revoke link sharing", documentId);
  }
}
