# CASA re-submission: revised answers for the 24 failed requirements

Written for: the person pasting these into the TAC portal (Developer Comment field).
Source of the failures: TAC's tester comments on scan `VlVsckgw…`, reviewed 2026-11-01.

**How to use**
- Each block is paste-ready. Items marked **[CONFIRM]** are facts only you can check (dashboards, settings). Replace or delete them. Do not submit a claim you have not verified.
- TAC said "the submitted image was unavailable" on most items. **Put the evidence in the comment as text** (code excerpt, command output, header dump) and attach PDFs, not screenshots, where the portal allows.
- Everything below was checked against the code on `staging_main` (commit after 2026-11-01 merges) unless marked otherwise.

## Two honest findings before you submit

1. **Raw database error text reaches the browser** (affects 6.2.1). 142 places across 84 of 165 API routes return `error.message` from Supabase/Postgres in the JSON body. Answer 6.2.1 below is written truthfully around this. Fixing it properly means a central error sanitiser; see "Optional hardening".
2. **`npm audit` is no longer clean** (affects 6.1.1). 3 moderate findings, one chain: `minimatch` DoS → `readdir-glob` → `archiver` (Drive folder ZIP download). No high or critical. The patterns are server-chosen, not user-supplied.

Already fixed in code for this submission: `unsafe-eval` removed from the production CSP; session cookie is HttpOnly; token encryption now fails closed in production if the key is missing.

---

## 1.1.1 Brute-force resistance

Authentication is delegated to Supabase Auth (external service). Supabase rate-limits sign-in and OTP/link verification per IP (30 verifications per 5 minutes per IP) and returns HTTP 429 beyond that; the application passes that through (`app/api/auth/signin/route.ts`). Administrators are expected to sign in with Google SSO, so their credential is protected by Google's own abuse protections and 2-Step Verification (see 3.3.1 for the one gap). Team-member passwords have a minimum length of 8 characters. Sign-in is performed server-side only, so every attempt reaches a point where it can be rate-limited and logged. **[CONFIRM: Supabase dashboard > Authentication > Rate Limits screenshot or text values; and whether CAPTCHA protection is enabled. If Supabase is on the ADA-approved authentication list, cite where: https://appdefensealliance.dev/casa/casa-requirements ]**

## 1.2.1 No default credentials on public interfaces

The application ships no seeded, demo, test or vendor default accounts. Every account is created by an administrator (first password set over HTTPS) or by Google sign-in. The public interfaces are: the Next.js web application and its API routes (all authenticated except `/privacy`, `/terms`, `/account-deletion` and the sign-in page); there is no CMS, no database admin UI, no framework console and no debug endpoint exposed. The database (Supabase) and hosting dashboards are third-party management planes, protected by the provider's own accounts with 2-Step Verification. **[CONFIRM: 2FA is enabled on the Supabase, Vercel and Google Cloud accounts.]**

## 2.2.1 Logout and session expiry invalidate tokens

Sign out calls `POST /api/auth/signout`, which runs Supabase `auth.signOut()` server-side (revokes the refresh token and session) and deletes every `sb-*` cookie (`app/api/auth/signout/route.ts`). Expiry: the access token (JWT) lifetime is 1 hour; the refresh token is single-use and rotated on every refresh, and a reused token is rejected (Supabase refresh-token reuse detection). On every request the middleware verifies the session with `auth.getUser()`, which asks the Auth server and fails if the session has been revoked or has expired, so an expired or signed-out session cannot be used even with a still-unexpired JWT (`middleware.ts`, `lib/auth-user.ts`). Password change or reset also ends the user's other sessions. **[CONFIRM: Supabase dashboard > Authentication > Sessions: state any inactivity timeout / time-box that is set, or say none is set and sessions last until sign-out.]**

## 2.2.2 Other sessions ended after password change

Changing the password from the profile page (`/api/me/password`, requires the current password) revokes all other sessions and refresh tokens and keeps the current one. A password reset through the emailed link revokes all sessions, and the person must set a new password before any other page or API works (middleware). The application has a single identity provider (Supabase Auth). Google is used as a sign-in method that produces a Supabase session; it is not a separate session the application keeps, and the application is not a relying party for any other service. Google sign-in accounts have no application password to change; their session is ended by signing out (above) and Google's own account controls. **[CONFIRM wording is acceptable to you: admins on Google SSO cannot "change password" in the app.]**

## 2.2.3 Non-revocable stateless tokens expire within 24 hours

The only stateless token is the Supabase access JWT, with a 1-hour lifetime (Supabase default `jwt_exp = 3600`). It is not treated as non-revocable by the application: each request verifies it with `auth.getUser()` (a call to the Auth server that checks the live session), so a revoked session is rejected immediately, not after JWT expiry. Refresh tokens are stateful, rotated and revocable. **[CONFIRM: dashboard shows JWT expiry = 3600.]**

## 2.3.2 Session cookies are HttpOnly

Fixed. The session cookie is now issued by the server only, with `HttpOnly`, `Secure` (production) and `SameSite=Lax`. Password sign-in, sign-out and the "who am I" check run through `/api/auth/signin`, `/api/auth/signout` and `/api/auth/session`; the browser never reads the session (`document.cookie` shows no `sb-*-auth-token`). Cookie writes set `httpOnly: true` in `middleware.ts`, `lib/supabase-server.ts` and `app/auth/callback/exchange/route.ts`. The only script-readable auth cookie is the short-lived OAuth PKCE code-verifier created when sign-in with Google or an email link starts; it is not a session token and is deleted when the code is exchanged. **[EVIDENCE: after testing, paste the `Set-Cookie` response header from the sign-in request (DevTools > Network) showing HttpOnly; Secure; SameSite=Lax, and the result of `document.cookie` showing no session cookie.]**

## 2.3.3 Session tokens rather than static API secrets

Users authenticate with Supabase session tokens (JWT + rotating refresh token) generated fresh at each successful sign-in (`signInWithPassword` in `app/api/auth/signin/route.ts`; `exchangeCodeForSession` in `app/auth/callback/exchange/route.ts`). No static key authenticates a user to the application. The static secrets that exist are server-to-server credentials for third-party services (Exotel, Lusha, OpenAI) held only in server environment variables; they are never sent to the browser and are not used to identify users. These are integration credentials, not user session tokens.

## 3.1.4 IDOR protection (CRUD)

Every route that takes an object ID resolves the caller first and then checks the object against them; ID unguessability is not relied on. Pattern by resource type:

| Resources (routes) | Mechanism |
|---|---|
| Gmail threads/labels, Drive files/folders/permissions, Docs, Sheets, Forms, Calendar events (`/api/gmail/*`, `/api/drive/*`, `/api/docs/*`, `/api/sheets/*`, `/api/forms/*`, `/api/calendar/*`) | Call Google with the caller's own OAuth token (`requireGmailAccessToken`). Google enforces ownership; another user's ID returns 403/404 for create, read, update and delete. |
| Sequences, steps, enrollments, attachments (`/api/sequences/[sequenceId]/…`) | `getSequenceContext` + `loadOwnedSequence` run on GET, PATCH and DELETE before any read or write; foreign IDs return 404. |
| Mail templates (`/api/mail-templates/[templateId]/…`) | Queries filter `.eq("user_id", user.id)` for read, update and delete. |
| CRM leads and stages (`/api/crm/leads/[id]`, `/api/crm/stages/[id]`) | Queries filter `.eq("user_id", …)`. |
| Campaigns (`/api/campaigns/[campaignId]`) | Filtered by `user_id`. |
| Directory contacts (`/api/directory-contacts/[id]/…`) | Intentionally shared across the workspace; uses the caller's RLS-scoped client, so only signed-in team members reach it. |
| WhatsApp messages (`/api/whatsapp/messages/[id]`) | Scoped to the caller's assigned business line. |
| Tracking pixel (`/api/track/[id]`) | Public by design (records an email open); returns no data. |

Postgres row-level security is enabled on all public tables as a second layer. **[CONFIRM before submitting: `/api/campaigns`, `/api/directory-contacts` DELETE and `/api/whatsapp/*` were checked by reading code only; run one cross-account test (use account B's ID while signed in as account A) on sequences, templates and one more, and note the result.]**

## 3.2.2 OAuth redirect_uri and state validation

Redirect URI: one fixed same-origin callback (`/auth/callback`) is registered with both Google and Supabase; wildcard or arbitrary redirect targets are not registered. The post-sign-in `next` parameter is restricted to same-site paths (absolute URLs, protocol-relative URLs and backslashes are rejected, `safeNextPath`). State: the OAuth flow is run by Supabase Auth with PKCE. `signInWithOAuth` generates a random `state` and a PKCE code verifier; the verifier is stored in a cookie in the initiating browser, and `exchangeCodeForSession` in `app/auth/callback/exchange/route.ts` sends the code with that verifier, which Supabase validates against the stored challenge and state; a callback from a different browser or without the matching verifier fails (the page shows the "PKCE / code verifier" error). **[CONFIRM: Supabase Auth validates `state` on its `/auth/v1/callback` endpoint before redirecting back to us. Say so only if you accept this from Supabase's documentation.]**

## 3.3.1 MFA on administrative interfaces

The application's administrative functions (team management, module configuration) are reachable at the same public URL, only by accounts with the `admin` role. Administrators sign in through Google SSO, and the emailed sign-in link is refused for admin accounts (`ADMIN_USES_GOOGLE_MESSAGE` in `app/auth/callback/exchange/route.ts`), so the second factor is enforced by Google. **Gap: password sign-in is not currently refused for admin accounts. If an admin has set a password, it bypasses Google 2-Step Verification. Do not claim "admins can sign in only through Google" until Optional hardening item 3 is done.** **[CONFIRM and provide as text: Google Workspace Admin > Security > 2-Step Verification is set to *Enforced* for the organisational unit containing every admin (or list each admin and that 2SV is on). "Enabled" is not enough for TAC; they need "enforced".]** Hosting and database consoles (Vercel, Supabase) are separate cloud management planes outside the application layer.

## 4.1.1 TLS 1.2+ and secure ciphers

HTTPS is enforced by the hosting platform with HSTS (`Strict-Transport-Security: max-age=63072000; includeSubDomains`, `next.config.mjs`). **[EVIDENCE REQUIRED: run https://www.ssllabs.com/ssltest/ against the production hostname, then attach the report (PDF or text) showing hostname, date, protocols (TLS 1.2/1.3 only), cipher suites and grade. Without it this requirement will fail again.]**

## 4.1.2 Trusted certificates

The production certificate is issued by a public CA **[name from the SSL Labs report]**, managed and renewed by the hosting platform; no self-signed or internal CA certificates are used, and the application disables no certificate validation. **[EVIDENCE REQUIRED: the "Certificate" and "Certification Paths" sections of the same SSL Labs report, showing the chain is trusted. Confirm the CA name from the report.]**

## 4.1.3 No weak cryptography

Inventory of cryptography in the application:
- **Google OAuth tokens at rest:** AES-256-GCM (Node `crypto`), a fresh random 96-bit IV from `randomBytes(12)` for every encryption, auth tag stored and verified, format `enc:v1:<iv>.<tag>.<ct>` (`lib/token-crypto.ts`). The 256-bit key is held in the `GOOGLE_TOKEN_ENCRYPTION_KEY` environment variable, a different key per environment (QA/production), never in source control. Production refuses to store a token if the key is missing.
- **Passwords:** never handled by the application; Supabase Auth stores salted bcrypt hashes.
- **Session tokens:** Supabase-signed JWTs.
- **Transport:** TLS 1.2+ (see 4.1.1).
- No custom or home-built cryptography; no MD5, SHA-1, DES/3DES, RC4 or ECB in application code. **[CONFIRM: key rotation. State your actual practice (e.g. "rotated on suspected exposure and annually via re-encrypt script") or "no scheduled rotation yet; planned".]**

## 4.1.4 Cryptographic modules fail securely

Decryption uses AES-GCM authenticated encryption, so tampered or truncated ciphertext fails authentication and throws; it is never partially decrypted (no CBC/padding, so no padding-oracle surface). A malformed stored value throws a fixed `Malformed encrypted token` error and an encrypted value without a key throws; none of these messages reaches the user, because token operations run server-side and callers log a generic line and return a generic failure (e.g. `[auth/callback/exchange] Failed to persist Google mailbox credentials`, with no token or ciphertext in the message). Encryption without a configured key now throws in production instead of silently storing plaintext (`lib/token-crypto.ts`). Stack traces are not returned to clients by Next.js in production.

## 5.1.3 No eval or dynamic code execution

The application source (`app`, `components`, `lib`, `hooks`, `middleware.ts`) contains no `eval()`, `new Function()`, or string arguments to `setTimeout`/`setInterval` (searched with `grep -rnE "\beval\(|new Function\("`, no matches). The production Content-Security-Policy no longer includes `'unsafe-eval'` (`next.config.mjs`; it is added only in development for hot reload), so the browser also blocks dynamic code execution. **[EVIDENCE: paste the response header from the production site (`curl -sI https://<prod>/` and show the `Content-Security-Policy` line has no `unsafe-eval`) and the grep command with its empty output.]** Be aware: `'unsafe-inline'` remains in `script-src` (required by Next.js inline scripts) and is a separate item, planned to be replaced with nonces.

## 5.1.6 XML / XPath injection

The application has no XPath queries and no XML parsing of user input in its own code. The browser `DOMParser` is used only to parse HTML to plain text in the editor. Users can upload spreadsheets (.xlsx is zipped XML), which are parsed server-side by the SheetJS library (version 0.20.3, the release that fixes its known advisories); it uses its own parser and does not resolve external entities or DTDs. File size is limited (4–5 MB) and row counts capped on the parse routes (`app/api/directory-contacts/import/parse`, `app/api/broadcast/parse-*`). **[CONFIRM: you accept the SheetJS statement; if unsure, drop the sentence "does not resolve external entities" and cite the version only.]**

## 5.1.9 OS command injection

The deployed application never executes operating-system commands: `child_process`, `exec`, `execSync`, `spawn` and `fork` do not appear in `app`, `lib`, `components`, `hooks` or `middleware.ts` (search run on `staging_main`; no matches). File-handling uses in-memory buffers and the Google/Supabase APIs. Maintenance scripts in `scripts/` run only from a developer machine and are not part of the deployed bundle. **[EVIDENCE: paste the grep command and its empty output. If `scripts/` use child_process, say they are not deployed or remove that sentence.]**

## 5.2.1 Malicious file uploads

Upload surfaces (all authenticated, all server-side size-limited):

| Route | Purpose | Limit | Destination |
|---|---|---|---|
| `/api/drive/upload`, `/upload-chunk` | User uploads to their own Drive | 50 MB / 5 MB chunks | User's Google Drive (filename sanitised) |
| `/api/drive/upload-for-email` | Large email attachment via Drive | 500 MB | User's Google Drive |
| `/api/gmail/drafts/attachment-chunk`, `/api/gmail/drafts` | Email attachments | per-attachment cap, 4 MB chunks | Temporary staging, then the user's Gmail draft (staging id sanitised to `[a-zA-Z0-9._-]`) |
| `/api/mail-templates/[id]/attachments(/stage)`, sequence step attachments | Template/sequence attachments | size checked before a signed upload URL is issued; files over Gmail's 25 MB go to Drive instead | Supabase Storage bucket **[CONFIRM the bucket is private]** |
| `/api/whatsapp/upload` | WhatsApp media | per-media-type caps (`lib/whatsapp-media-storage.ts`) | Supabase Storage |
| `/api/directory-contacts/import/parse`, `/api/broadcast/parse-*` | CSV/XLSX import | 4–5 MB, row-capped | Parsed in memory, discarded |

Uploaded files are never stored in a web-served directory and never executed by the server; files go to Google Drive, Gmail or private object storage, where Google's malware scanning applies, and import files are parsed as data only. **Gap to state honestly:** the generic upload routes do not restrict by file extension or MIME type, because users legitimately attach arbitrary business files. **[DECISION: either (a) submit as above, or (b) add the executable-extension blocklist described under "Optional hardening" first and then state it here. Recommended: (b).]**

## 6.1.1 No known exploitable vulnerable components

`npm audit` on the production dependency tree (run 2026-11-01 on `staging_main`): **0 critical, 0 high, 3 moderate.** The 3 moderate findings are one chain: `minimatch` <11.0.1 (DoS through glob amplification, GHSA-g3hv-75wg-m249) via `readdir-glob` via `archiver`, used only to ZIP Drive folders for download. The glob patterns are fixed by the server, not supplied by users, so the issue is not exploitable here; the npm-suggested "fix" is a breaking downgrade (`archiver@4.0.2`) and is not applied. Next.js is at 15.5.28 (no known advisories), xlsx at 0.20.3. **[EVIDENCE: attach the full `npm audit --omit=dev` output as text. Decide whether to schedule the `archiver` upgrade.]**

## 6.2.1 Debug modes disabled in production

Production runs the optimised `next build` / `next start` (`NODE_ENV=production`): React and Next development overlays, hot reload and the dev-only `unsafe-eval` are off; no developer console or debug route is deployed; `X-Powered-By` is removed; browser source maps are not published (`productionBrowserSourceMaps` is unset, default off). Unhandled errors show Next.js's generic error page without stack traces. **Disclosure:** some API routes return the database's error message text in their JSON error body (for example a Postgres constraint or query message); no stack traces, file paths, secrets or connection strings are included. **[DECISION: this is a real information-disclosure weakness. Either fix it first (see "Optional hardening") or submit with this disclosure and expect a possible fail.]**

## 6.4.1 Subdomain takeover

**[EVIDENCE REQUIRED. Export your DNS zone from the registrar/DNS host and list every record: name, type, target, and who owns the target. Example row format: `app.<domain> CNAME cname.vercel-dns.com — Vercel project <name>, active`.]** Statement to pair with it: every subdomain that exists points at a resource we control and use (the Vercel project, the Supabase custom domain if any, mail records); there are no wildcard records and no records pointing at decommissioned third-party services; the list is reviewed whenever a service is added or removed. **[CONFIRM each clause against the real export.]**

## 6.5.1 No credentials or payment details in logs

The application does not handle payment details. Passwords are never read by the application's logging; the sign-in route returns only the Supabase error message and logs nothing. Log statements in the code (137 `console.*` calls) write fixed messages plus an error object or message, for example `[auth/callback/exchange] Failed to persist Google mailbox credentials`; searching for log statements that include `token`, `password`, `secret`, `authorization`, `cookie` or `refresh` as values finds none; the bearer-token rejection log prints only the Supabase error message, not the token. Session tokens are not logged at all, hashed or otherwise. Logs live in the hosting platform's log store, accessible only to team members on the hosting account. **[EVIDENCE: paste the grep command used and a redacted sample of production log lines from a sign-in and a sign-out.]**

## 6.6.1 Browser storage cleared on logout

Inventory of browser storage: **sessionStorage**, used only as a cache of the signed-in user's mail lists, thread bodies and profile, cleared in full by `clearClientData()` (`lib/clear-client-data.ts`) before every sign-out; **localStorage**, used only for layout preferences (sidebar width/collapse, Drive view mode and sort), which hold no user data and are left in place; **cookies**, the HttpOnly session cookies deleted by `/api/auth/signout`. IndexedDB, the Cache API, service workers and WebSQL are not used anywhere in the application (searched `app`, `components`, `hooks`, `lib`: no matches for `indexedDB`, `caches.open`, `serviceWorker`, `openDatabase`). No authentication token, refresh token or password is ever stored in browser storage; the session lives only in the HttpOnly cookie.

## 6.7.1 Secure storage of server-side secrets

Secrets (Supabase service-role key, Google OAuth client secret, Exotel/Lusha/OpenAI keys, `GOOGLE_TOKEN_ENCRYPTION_KEY`) are held as encrypted environment variables on the hosting platform (Vercel), set per environment, and are not committed to source control (gitleaks scan of the full history: no findings). They are read only in server code (`server-only` modules); the only `NEXT_PUBLIC_` values are the Supabase URL and anon key, which are public by design and constrained by row-level security. Third-party credentials that users store (Google tokens, integration API keys) are encrypted at rest with AES-256-GCM (see 4.1.3). **[CONFIRM and add as text: who has access to the Vercel project and its environment variables (list roles, least privilege); whether Vercel audit logging records access to environment variables (plan-dependent); and your rotation practice.]**

---

## Optional hardening (real code gaps behind two answers)

1. **Sanitise API error messages (6.2.1, also 4.1.4):** add a helper that logs the real error server-side and returns a generic message to the client, then apply it to the 142 `error: error.message` sites (mechanical but wide; needs a UI regression pass because some screens display these messages). Recommend doing this before resubmitting, because 6.2.1 is a likely repeat fail otherwise.
2. **Executable-extension blocklist on server upload routes (5.2.1):** reject `.exe .bat .cmd .com .scr .msi .jar .js .vbs .ps1 .sh` and similar on `/api/drive/upload*`, `/api/gmail/drafts/attachment-chunk`, template/sequence attachment and WhatsApp upload routes. Gmail already refuses most of these, so legitimate use is unaffected.
3. **Block password sign-in for admin accounts (3.3.1):** in `/api/auth/signin`, after a successful sign-in look up the role and, for `admin`, sign out and return `ADMIN_USES_GOOGLE_MESSAGE`. **Behaviour change:** any admin who signs in with a password today (including you, if you do) would be locked to Google sign-in. Check this before enabling.
4. **`archiver` / `minimatch` (6.1.1):** upgrade when a non-breaking path exists; not required to pass.
