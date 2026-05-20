# Google Cloud setup for Placecom (handoff)

Share this with whoever manages the Google Cloud / Supabase project so Google tokens keep working without frequent re-login.

## 1. OAuth client secret (most important)

The app already uses this OAuth Web client ID (same as Supabase Google login):

- Client ID: value of `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in the app (ends with `.apps.googleusercontent.com`)

**Action:** In [Google Cloud Console](https://console.cloud.google.com/) → **APIs & Services** → **Credentials** → open that **OAuth 2.0 Client ID** (Web application) → copy the **Client secret**.

Add it to:

| Where | Variable |
|--------|----------|
| Local dev | `.env.local` → `GOOGLE_OAUTH_CLIENT_SECRET=...` |
| Production (Vercel) | Project → Settings → Environment Variables → `GOOGLE_OAUTH_CLIENT_SECRET` |

Without this secret, stored **refresh tokens** cannot be renewed after ~1 hour. Users see “Google token expired” on Dashboard/Inbox/Calendar (admin mailbox).

Meet scheduling for `g24072@astra.xlri.ac.in` can still work via app sign-in, but long-term refresh for **both** organizer and admin mailbox needs this secret.

---

## 2. Authorized redirect URIs (already required for login)

On the **same** OAuth Web client, under **Authorized redirect URIs**, ensure these exist:

```
https://<YOUR_SUPABASE_PROJECT_REF>.supabase.co/auth/v1/callback
```

Example for this project: `https://ljaelwxmgzmirofitacm.supabase.co/auth/v1/callback`

Optional (only if using `npm run auth:meet-organizer` locally):

```
http://127.0.0.1:3456/oauth/callback
```

---

## 3. APIs enabled

In **APIs & Services** → **Library**, enable for the project:

- Gmail API  
- Google Calendar API  
- Google Drive API (if using Drive page)

---

## 4. OAuth consent screen & scopes

**APIs & Services** → **OAuth consent screen**:

- App in **Testing** or **Production** (Production avoids some refresh limits for external testers).
- Add test users if still in Testing (admin + `g24072@astra.xlri.ac.in` + any staff emails).

**Data access / Scopes** should include (app requests these on sign-in):

- `openid`, `userinfo.email`
- `gmail.readonly`, `gmail.send`
- `calendar.readonly`, `calendar.events`
- `drive.readonly`

Match `lib/google-config.ts` → `GOOGLE_OAUTH_SCOPES`.

---

## 5. Supabase Auth → Google provider

Supabase Dashboard → **Authentication** → **Providers** → **Google**:

- Use the **same** Client ID and Client secret as above.
- Enable **Skip nonce check** only if Google login fails with nonce errors (optional).

---

## 6. After deploy

1. Set `GOOGLE_OAUTH_CLIENT_SECRET` on Vercel → redeploy.  
2. Admin (`chetangalla248@gmail.com`) signs in with Google once on production → refreshes stored mailbox token.  
3. Organizer (`g24072@astra.xlri.ac.in`) signs in once if using Meet host account → refreshes organizer token in DB.

---

## Token behavior (what “expire fast” means)

| Token | Lifetime | Notes |
|--------|----------|--------|
| Access token | ~1 hour | Auto-refreshed server-side when `GOOGLE_OAUTH_CLIENT_SECRET` is set |
| Refresh token | Long-lived | Revoked only if user removes app access or OAuth client changes |
| Supabase session | Separate | Sign-in session; not the same as Gmail/Calendar API token |

**“Expire fast”** usually means missing **client secret** or admin has not re-signed in after secret was added.

---

## Meet organizer (current setup)

- Meet links: **`g24072@astra.xlri.ac.in`**
- Always invited: **`chetangalla248@gmail.com`**
- Env (optional overrides): `GOOGLE_MEET_ORGANIZER_EMAIL`, `GOOGLE_MEET_ORGANIZER_ADMIN_EMAIL`

No extra Cloud Console step beyond sections 1–5.
