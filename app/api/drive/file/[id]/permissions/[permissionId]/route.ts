import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  deleteFilePermission,
  updateFilePermission,
  type DriveRole,
} from "@/lib/drive";

export const runtime = "nodejs";

function errResponse(e: unknown) {
  const err = e as Error & { code?: string };
  if (err.code === "UNAUTHORIZED") {
    return NextResponse.json(
      { error: "Google token expired. Sign in again." },
      { status: 401 }
    );
  }
  if (err.code === "DRIVE_INSUFFICIENT_SCOPE") {
    return NextResponse.json(
      {
        error: "DRIVE_INSUFFICIENT_SCOPE",
        message:
          "Drive sharing requires the full drive scope. Sign out and sign in again to grant it.",
      },
      { status: 403 }
    );
  }
  return NextResponse.json(
    { error: err.message || "Drive permission request failed" },
    { status: 500 }
  );
}

const VALID_ROLES: DriveRole[] = ["reader", "commenter", "writer"];

/** PATCH — change a permission's role. */
export async function PATCH(
  request: Request,
  { params }: { params: { id: string; permissionId: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const fileId = params.id?.trim();
  const permissionId = params.permissionId?.trim();
  if (!fileId || !permissionId) {
    return NextResponse.json({ error: "Missing ids" }, { status: 400 });
  }

  let body: { role?: DriveRole };
  try {
    body = (await request.json()) as { role?: DriveRole };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body.role || !VALID_ROLES.includes(body.role)) {
    return NextResponse.json(
      { error: "role must be reader, commenter, or writer" },
      { status: 400 }
    );
  }

  try {
    const permission = await updateFilePermission(
      auth.accessToken,
      fileId,
      permissionId,
      body.role
    );
    return NextResponse.json({ permission });
  } catch (e) {
    return errResponse(e);
  }
}

/** DELETE — revoke a permission. */
export async function DELETE(
  request: Request,
  { params }: { params: { id: string; permissionId: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const fileId = params.id?.trim();
  const permissionId = params.permissionId?.trim();
  if (!fileId || !permissionId) {
    return NextResponse.json({ error: "Missing ids" }, { status: 400 });
  }
  try {
    await deleteFilePermission(auth.accessToken, fileId, permissionId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errResponse(e);
  }
}
