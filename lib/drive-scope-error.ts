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
  if (body.message?.trim()) return body.message.trim();
  const code = body.error?.trim();
  if (code === DRIVE_INSUFFICIENT_SCOPE) return DRIVE_INSUFFICIENT_SCOPE_MESSAGE;
  return code || fallback;
}
