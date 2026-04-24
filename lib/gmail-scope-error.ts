/** Returned on `Error` objects from Gmail helpers when Google rejects the token for missing OAuth scopes. */
export const GMAIL_INSUFFICIENT_SCOPE = "GMAIL_INSUFFICIENT_SCOPE" as const;

export const GMAIL_INSUFFICIENT_SCOPE_MESSAGE =
  "Your Google sign-in did not grant Gmail API access. In Google Cloud Console for the same OAuth client used by Supabase: enable the Gmail API; under Google Auth Platform → Data access (Scopes), add https://www.googleapis.com/auth/gmail.readonly and https://www.googleapis.com/auth/gmail.send; then sign out of this app and sign in with Google again and accept Gmail permissions.";

export function isGmailInsufficientScopeResponse(
  status: number,
  bodyText: string
): boolean {
  if (status !== 403) return false;
  return (
    bodyText.includes("ACCESS_TOKEN_SCOPE_INSUFFICIENT") ||
    (bodyText.includes("insufficientPermissions") &&
      bodyText.includes("gmail.googleapis.com"))
  );
}

export function throwIfGmailInsufficientScope(
  status: number,
  bodyText: string
): void {
  if (!isGmailInsufficientScopeResponse(status, bodyText)) return;
  const err = new Error(GMAIL_INSUFFICIENT_SCOPE_MESSAGE) as Error & {
    code: typeof GMAIL_INSUFFICIENT_SCOPE;
  };
  err.code = GMAIL_INSUFFICIENT_SCOPE;
  throw err;
}

export function gmailInsufficientScopePayload(): {
  error: typeof GMAIL_INSUFFICIENT_SCOPE;
  message: string;
} {
  return { error: GMAIL_INSUFFICIENT_SCOPE, message: GMAIL_INSUFFICIENT_SCOPE_MESSAGE };
}
