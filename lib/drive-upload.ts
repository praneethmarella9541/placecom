import "server-only";

import { describeUpstreamFetchError } from "@/lib/fetch-errors";

const UPLOAD_API = "https://www.googleapis.com/upload/drive/v3";

/** Google recommends multipart (one request) for smaller files. */
const MULTIPART_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;

const UPLOAD_FIELDS = "id,name,mimeType,modifiedTime,size,webViewLink";

function driveUploadScopeError(initRes: Response, initText: string): Error & {
  status?: number;
  body?: string;
  code?: string;
} {
  const err = new Error(`Drive upload ${initRes.status}: ${initText}`) as Error & {
    status?: number;
    body?: string;
    code?: string;
  };
  err.status = initRes.status;
  err.body = initText;
  if (initRes.status === 401) err.code = "UNAUTHORIZED";
  if (
    initRes.status === 403 &&
    (initText.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
      (initText.includes("insufficientPermissions") && initText.includes("drive.googleapis.com")))
  ) {
    err.code = "DRIVE_UPLOAD_INSUFFICIENT_SCOPE";
    err.message =
      "Upload requires Google Drive write access. Add scope https://www.googleapis.com/auth/drive to your OAuth client and Supabase Google provider, then sign out and sign in again.";
  }
  return err;
}

function buildParents(parentId: string): string[] {
  const id = parentId.trim() || "root";
  return id === "root" ? ["root"] : [id];
}

function buildMultipartBody(
  meta: Record<string, unknown>,
  mimeType: string,
  body: Buffer
): { payload: Buffer; contentType: string } {
  const boundary = `placecom_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metaPart = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`,
    "utf8"
  );
  const fileHeader = Buffer.from(
    `--${boundary}\r\nContent-Type: ${mimeType || "application/octet-stream"}\r\n\r\n`,
    "utf8"
  );
  const end = Buffer.from(`\r\n--${boundary}--`, "utf8");
  return {
    payload: Buffer.concat([metaPart, fileHeader, body, end]),
    contentType: `multipart/related; boundary=${boundary}`,
  };
}

async function uploadBinaryToDriveMultipart(
  accessToken: string,
  options: {
    fileName: string;
    mimeType: string;
    parentId: string;
    body: Buffer;
  }
): Promise<DriveUploadResult> {
  const meta = {
    name: options.fileName,
    parents: buildParents(options.parentId),
  };
  const { payload, contentType } = buildMultipartBody(
    meta,
    options.mimeType || "application/octet-stream",
    options.body
  );

  let res: Response;
  try {
    res = await fetch(`${UPLOAD_API}/files?uploadType=multipart&fields=${UPLOAD_FIELDS}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
        "Content-Length": String(payload.length),
      },
      body: new Uint8Array(payload),
    });
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Drive upload (multipart)"));
  }

  const text = await res.text();
  if (!res.ok) throw driveUploadScopeError(res, text);

  try {
    const data = JSON.parse(text) as DriveUploadResult;
    if (!data.id) throw new Error("Drive upload: no file id in response");
    return data;
  } catch (e) {
    if (e instanceof SyntaxError) throw new Error("Drive upload: invalid JSON response");
    throw e;
  }
}

export type DriveUploadResult = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  size?: string;
  webViewLink?: string;
};

/**
 * Upload a file into a Drive folder (or My Drive root with parentId `root`) via resumable upload.
 * Requires OAuth scope `https://www.googleapis.com/auth/drive`.
 */
export async function uploadBinaryToDrive(
  accessToken: string,
  options: {
    fileName: string;
    mimeType: string;
    /** Folder id, or `"root"` for My Drive root */
    parentId: string;
    body: Buffer;
  }
): Promise<DriveUploadResult> {
  if (options.body.length <= MULTIPART_UPLOAD_MAX_BYTES) {
    return uploadBinaryToDriveMultipart(accessToken, options);
  }

  const parents = buildParents(options.parentId);
  const meta = JSON.stringify({
    name: options.fileName,
    parents,
  });

  let initRes: Response;
  try {
    initRes = await fetch(
      `${UPLOAD_API}/files?uploadType=resumable&fields=id,name,mimeType,modifiedTime,size,webViewLink`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": options.mimeType || "application/octet-stream",
          "X-Upload-Content-Length": String(options.body.length),
        },
        body: meta,
      }
    );
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Drive upload (start session)"));
  }

  const initText = await initRes.text();
  if (!initRes.ok) {
    throw driveUploadScopeError(initRes, initText);
  }

  const sessionUrl = initRes.headers.get("Location");
  if (!sessionUrl) {
    throw new Error("Drive upload: missing Location header from resumable session");
  }

  let putRes: Response;
  try {
    putRes = await fetch(sessionUrl, {
      method: "PUT",
      headers: {
        "Content-Length": String(options.body.length),
        "Content-Type": options.mimeType || "application/octet-stream",
      },
      body: new Uint8Array(options.body),
    });
  } catch (e) {
    throw new Error(describeUpstreamFetchError(e, "Google Drive upload (send bytes)"));
  }

  const putText = await putRes.text();
  if (!putRes.ok) {
    throw new Error(`Drive upload PUT ${putRes.status}: ${putText}`);
  }

  try {
    const data = JSON.parse(putText) as DriveUploadResult;
    if (!data.id) throw new Error("Drive upload: no file id in response");
    return data;
  } catch (e) {
    if (e instanceof SyntaxError) {
      throw new Error("Drive upload: invalid JSON response");
    }
    throw e;
  }
}
