import { NextResponse } from "next/server";
import { requireGmailAccessToken } from "@/lib/gmail-auth";
import {
  addFilePermission,
  getFileShareLink,
  listFilePermissions,
  type DrivePermissionType,
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
  if (err.code === "DRIVE_NO_SHARE_PERMISSION") {
    return NextResponse.json(
      {
        error: "DRIVE_NO_SHARE_PERMISSION",
        message:
          "You don't have permission to share this item. Only the owner (or someone they've given sharing rights to) can change who has access.",
      },
      { status: 403 }
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
    { error: err.message || "Drive permissions request failed" },
    { status: 500 }
  );
}

/** GET — list the permissions on a file/folder + return its share link. */
export async function GET(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const fileId = params.id?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "Missing file id" }, { status: 400 });
  }
  try {
    const [permissions, shareLink] = await Promise.all([
      listFilePermissions(auth.accessToken, fileId),
      getFileShareLink(auth.accessToken, fileId).catch(() => null),
    ]);
    return NextResponse.json({ permissions, shareLink });
  } catch (e) {
    return errResponse(e);
  }
}

type AddBody = {
  role?: DriveRole;
  type?: DrivePermissionType;
  emailAddress?: string;
  domain?: string;
  sendNotificationEmail?: boolean;
  emailMessage?: string;
};

const VALID_ROLES: DriveRole[] = ["reader", "commenter", "writer"];
const VALID_TYPES: DrivePermissionType[] = ["user", "group", "domain", "anyone"];

/** POST — add a permission (share with a person or make link-shareable). */
export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
  const auth = await requireGmailAccessToken(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const fileId = params.id?.trim();
  if (!fileId) {
    return NextResponse.json({ error: "Missing file id" }, { status: 400 });
  }

  let body: AddBody;
  try {
    body = (await request.json()) as AddBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.role || !VALID_ROLES.includes(body.role)) {
    return NextResponse.json(
      { error: "role must be reader, commenter, or writer" },
      { status: 400 }
    );
  }
  if (!body.type || !VALID_TYPES.includes(body.type)) {
    return NextResponse.json(
      { error: "type must be user, group, domain, or anyone" },
      { status: 400 }
    );
  }
  if ((body.type === "user" || body.type === "group") && !body.emailAddress) {
    return NextResponse.json(
      { error: "emailAddress is required for user/group permissions" },
      { status: 400 }
    );
  }
  if (body.type === "domain" && !body.domain) {
    return NextResponse.json(
      { error: "domain is required for domain permissions" },
      { status: 400 }
    );
  }

  try {
    const permission = await addFilePermission(auth.accessToken, fileId, {
      role: body.role,
      type: body.type,
      emailAddress: body.emailAddress?.trim(),
      domain: body.domain?.trim(),
      sendNotificationEmail: body.sendNotificationEmail,
      emailMessage: body.emailMessage,
    });
    return NextResponse.json({ permission }, { status: 201 });
  } catch (e) {
    return errResponse(e);
  }
}
