/** Returned on `Error` objects from Sheets helpers when Google rejects the token for missing OAuth scopes. */
export const SHEETS_INSUFFICIENT_SCOPE = "SHEETS_INSUFFICIENT_SCOPE" as const;

export const SHEETS_INSUFFICIENT_SCOPE_MESSAGE =
  "Your Google sign-in did not grant Sheets API access. In Google Cloud Console for the same OAuth client used by Supabase: enable the Google Sheets API; under Google Auth Platform → Data access (Scopes), add https://www.googleapis.com/auth/spreadsheets; then sign out of this app and sign in with Google again and accept the new permission.";

export function isSheetsInsufficientScopeResponse(
  status: number,
  bodyText: string
): boolean {
  if (status !== 403) return false;
  return (
    bodyText.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    (bodyText.includes("insufficientPermissions") &&
      bodyText.includes("sheets.googleapis.com"))
  );
}

export function throwIfSheetsInsufficientScope(
  status: number,
  bodyText: string
): void {
  if (!isSheetsInsufficientScopeResponse(status, bodyText)) return;
  const err = new Error(SHEETS_INSUFFICIENT_SCOPE_MESSAGE) as Error & {
    code: typeof SHEETS_INSUFFICIENT_SCOPE;
  };
  err.code = SHEETS_INSUFFICIENT_SCOPE;
  throw err;
}

export function sheetsInsufficientScopePayload(): {
  error: typeof SHEETS_INSUFFICIENT_SCOPE;
  message: string;
} {
  return { error: SHEETS_INSUFFICIENT_SCOPE, message: SHEETS_INSUFFICIENT_SCOPE_MESSAGE };
}
