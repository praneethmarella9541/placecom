/**
 * Public Google OAuth Web Client ID (same one configured in Supabase Auth → Google).
 * Must be set as NEXT_PUBLIC_GOOGLE_CLIENT_ID in .env — used for token refresh on the server.
 * Throws immediately if missing so misconfiguration surfaces as a clear startup error
 * rather than a cryptic "Could not determine client ID" from Google's token endpoint.
 */
export function getGoogleOAuthClientId(): string {
  const id = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim();
  if (!id) {
    throw new Error(
      "NEXT_PUBLIC_GOOGLE_CLIENT_ID is not set. Add it to .env — it must match the OAuth client ID configured in Google Cloud Console and Supabase Auth."
    );
  }
  return id;
}

/**
 * Minimal scopes for Supabase account linking + Gmail API token on the session.
 * - openid: OIDC
 * - userinfo.email: stable Google account id / email for Supabase user
 * - gmail.modify: list/read threads and messages, plus mark-as-read on open
 *   (supersedes gmail.readonly). Users must re-consent after this is added.
 * - gmail.send: send and reply (required for compose)
 * - calendar.readonly: list events for timeline/weekly views
 * - calendar.events: create recruiter meetings and add attendees
 * - drive: full Drive access — needed because the app lists arbitrary user
 *   files (drive.readonly behaviour), uploads (drive.file behaviour) AND
 *   manages permissions (sharing). The narrower scopes can't grant
 *   permission-write on files the app didn't itself create. After adding
 *   this scope, users must sign out and sign in again so the granted-scope
 *   list refreshes.
 * - contacts.readonly + contacts.other.readonly: People API — saved contacts & “Other contacts” for compose suggestions
 * - forms.body: create and edit Google Forms via Forms API (/forms workspace)
 * - forms.responses.readonly: list and read form responses in Placecom
 * Enable **People API** in the same Google Cloud project (APIs & Services → Enable APIs).
 * Enable **Google Forms API** for programmatic form creation.
 * Google must allow these scopes for your OAuth client or tokens will lack Gmail access
 * (403 ACCESS_TOKEN_SCOPE_INSUFFICIENT). Configure: Google Cloud Console → Google Auth
 * Platform → Data access (Scopes) — add the same Gmail URLs; enable Gmail API for the project.
 * Enable the Google Drive API and add the Drive scope for file listing.
 * https://console.cloud.google.com/auth/scopes
 *
 * Omitting userinfo.profile reduces consent surface; add it back if you need
 * name/avatar on first login before Supabase caches metadata.
 */
export const GOOGLE_OAUTH_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/forms.body",
  "https://www.googleapis.com/auth/forms.responses.readonly",
].join(" ");

/** Last few characters for UI diagnostics (not sensitive, but avoids full dump). */
export function maskGoogleClientId(clientId: string): string {
  const s = clientId.trim();
  if (!s) return "";
  if (s.length <= 8) return "••••••••";
  return `••••••${s.slice(-8)}`;
}

export function isGoogleClientConfigured(): boolean {
  return getGoogleOAuthClientId().length > 0;
}

/**
 * URI Google must allow for Supabase-hosted OAuth (Authorization code flow).
 * Add this under Google Cloud Console → OAuth client → Authorized redirect URIs.
 * Do NOT use http://localhost:... here — Google sends the user to Supabase first.
 */
export function getSupabaseOAuthRedirectUriForGoogle(): string {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!raw) return "";
  const base = raw.replace(/\/+$/, "");
  return `${base}/auth/v1/callback`;
}
