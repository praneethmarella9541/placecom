/** Returned on Drive API errors when Google rejects the token for missing OAuth scopes. */
export const DRIVE_INSUFFICIENT_SCOPE = "DRIVE_INSUFFICIENT_SCOPE" as const;

export const DRIVE_INSUFFICIENT_SCOPE_MESSAGE =
  "Your Google sign-in is missing Drive write access (needed to copy files). Sign out of Placecom, then sign in with Google again and accept all requested permissions.";

export function isDriveInsufficientScopeResponse(
  status: number,
  bodyText: string
): boolean {
  if (status !== 403) return false;
  return (
    bodyText.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    (bodyText.includes("insufficientPermissions") &&
      bodyText.includes("drive.googleapis.com"))
  );
}

export function driveInsufficientScopePayload(): {
  error: typeof DRIVE_INSUFFICIENT_SCOPE;
  message: string;
} {
  return { error: DRIVE_INSUFFICIENT_SCOPE, message: DRIVE_INSUFFICIENT_SCOPE_MESSAGE };
}

/** Prefer API `message`, map scope codes to a friendly string (for Drive UI alerts). */
export function driveApiErrorMessage(
  body: { error?: string; message?: string },
  fallback: string
): string {
  const raw = body.message?.trim() || body.error?.trim();
  if (raw === DRIVE_INSUFFICIENT_SCOPE) return DRIVE_INSUFFICIENT_SCOPE_MESSAGE;
  if (raw) return driveCopyErrorMessage(raw);
  return fallback;
}

/** Map Google Drive copy failures to clearer guidance. */
export function driveCopyErrorMessage(message: string): string {
  const m = message.trim();
  if (!m) return m;
  if (
    m.includes("cannot be copied") ||
    m.includes("cannotCopyFile") ||
    m.includes("insufficientFilePermissions")
  ) {
    return "You don't have permission to copy this item. Ask the owner for Editor access, or use Download instead.";
  }
  return m;
}
