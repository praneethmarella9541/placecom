/**
 * Public Google OAuth Web Client ID (same one configured in Supabase Auth → Google).
 * Used for client-side hints (preconnect, diagnostics). Not a secret.
 */
export function getGoogleOAuthClientId(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim() ?? "";
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
 * - drive.readonly: list and open Drive files from the Drive page (/drive)
 * - drive.file: upload files to Drive from Placecom (/api/drive/upload)
 * - contacts.readonly + contacts.other.readonly: People API — saved contacts & “Other contacts” for compose suggestions
 * - forms.body: create Google Forms via Forms API (/forms workspace)
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
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.file",
  "https://www.googleapis.com/auth/contacts.readonly",
  "https://www.googleapis.com/auth/contacts.other.readonly",
  "https://www.googleapis.com/auth/forms.body",
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
