# Placecom — Product Requirements Document (for Test Automation)

> **Purpose of this document.** This PRD is written specifically so that automated-testing agents
> (e.g. Playwright) can generate end-to-end and regression test cases for the Placecom web app.
> It describes *what each feature does*, *what the user sees*, *the happy-path flows*, *edge cases*,
> *access rules*, and *the external systems involved* (so tests know what to mock/stub vs. hit live).
> It is derived from a complete read of the codebase as of June 2026.

---

## 1. Product Overview

**Placecom** is a multi-user, role-based **placement-operations CRM** for a college/agency placement
team. It centralizes all recruiter communication and operations into one workspace: shared email
inbox, AI contact extraction, outbound/inbound calls, SMS, WhatsApp, calendar, meetings with AI
summaries, Google Drive file management, forms, broadcasting, and a sales-style lead CRM.

**Tech stack (relevant to testing):**

| Concern | Implementation |
|---|---|
| Framework | Next.js 14 (App Router), React 18, TypeScript |
| Styling | Tailwind CSS + custom design-system CSS variables (`--color-*`) |
| Auth & DB | Supabase (Postgres + Auth). SSR cookie sessions via `@supabase/ssr` |
| Auth methods | Google OAuth (admins), email+password, and magic link (staff/committee) |
| Email | Gmail API (Google OAuth tokens) |
| Files | Google Drive API |
| Calls/SMS | Exotel (current); Twilio (legacy, being phased out) |
| WhatsApp | Exotel WhatsApp Business API |
| AI | OpenAI (contact extraction, transcript summaries) |
| Meeting transcripts | Fireflies (webhook) |
| Hosting | Vercel |

**Important testing reality:** the app has **no `data-testid` attributes** today and **no existing
test suite**. Tests must select elements by **visible text, ARIA roles, placeholders, headings, and
`aria-*` attributes**. Section 9 lists recommended `data-testid`s to add for stable selectors.

---

## 2. Roles & Access Control

There are **three roles** stored on `profiles.role`:

| Role | Sign-in | Capabilities |
|---|---|---|
| `admin` | Google OAuth | Full access to all features + `/admin/team` and `/admin/analytics`. Creates staff/committee accounts, assigns Exotel numbers, manages access groups. |
| `staff` | email+password or magic link | Workspace features; no admin pages. |
| `committee` | email+password or magic link | Like staff but feature access can be **restricted** per-user or per access-group. |

### Access-control mechanisms (must be covered by tests)

1. **Per-user / per-group restricted features** — `profiles.restricted_features` and
   `team_groups.restricted_features` (merged in `lib/profile-access.ts`). Admins are never restricted.
2. **Domain-level feature cap** — env `NEXT_PUBLIC_ALLOWED_FEATURES` (e.g.
   `inbox,drive,forms,calendar`). When set, applies to **all roles including admin**. Used on
   subdomain deployments. Features outside the set are blocked.
3. **Enforcement point** — `middleware.ts`. A blocked **page** route → HTTP redirect to the first
   accessible workspace path. A blocked **API** route (`/api/...`) → `403 JSON`:
   - Group/user restricted: `{ "error": "This feature is disabled by your admin for your access group." }`
   - Domain cap: `{ "error": "This feature is not available on this portal." }`

### Feature keys (the unit of access control)

`inbox` (Mail), `drive` (Drive), `forms` (Forms), `broadcasting` (Broadcasting), `dashboard`
(Extraction), `crm` (CRM), `calendar` (Calendar), `meetings` (Meetings), `sms` (SMS),
`whatsapp` (WhatsApp). Path→feature mapping lives in `lib/feature-access.ts`.
Note: `/broadcasting?channel=sms` maps to `sms`; `?channel=whatsapp` maps to `whatsapp`;
`/contacts` maps to `whatsapp`.

**Test matrix to generate:** for each role × each feature × (allowed / restricted / domain-capped),
assert the nav item visibility, page accessibility, redirect target, and API 403 behavior.

---

## 3. Authentication & Session

### 3.1 Sign-in page (`/`, `app/page.tsx`)

Unauthenticated users see a split landing page:
- **Left:** marketing hero ("One workspace for mail, calls, and the whole team.").
- **Right:** sign-in card with three methods:
  - **"Continue with Google"** button (admins) → Supabase Google OAuth, redirect to `/auth/callback`.
  - **Staff & Committee:** email + password fields → **"Sign In"** button.
  - **"Use magic link instead"** toggle → reveals email field + **"Send Link"** button (OTP email).

**Behaviors to test:**
- Empty email on password sign-in → inline error "Enter your work email."
- Empty password → "Enter your password."
- Wrong credentials → Supabase error message surfaced in a red error box.
- Successful password sign-in → `window.location.href = "/inbox"`.
- Successful magic-link request → non-error confirmation text about checking email.
- An auth error returned in the URL (`?error=auth&msg=...`) renders a red "Sign-in failed" banner;
  PKCE/code-verifier errors append a same-browser tip.
- Already-signed-in visitor to `/` → shows an inbox-shaped skeleton then `window.location.replace("/inbox")`.

### 3.2 Auth callback routes
- `/auth/callback` and `/auth/callback/exchange` — OAuth/OTP code exchange. On failure → redirect to
  `/?error=auth&msg=...`.
- `/auth/mobile-bridge`, `/auth/mobile-callback` — mobile app bearer-token bridge (out of scope for web E2E).

### 3.3 Post-login landing & shell
- Default landing for **all roles** is **`/inbox`**.
- Authenticated routes live under the `(workspace)` route group wrapped by `AppShell`
  (`components/AppShell.tsx`), which redirects to `/` if there's no Supabase user.
- The left **sidebar** (`components/WorkspaceSidebar.tsx`) is the primary navigation. **Nav is hidden
  until `/api/me/mailbox` resolves** (to avoid a flash of features the user can't access) — tests
  should wait for the nav to appear.

### 3.4 Sign out
- Sidebar → user avatar (bottom-left) → dropdown → **"Sign out"**. Clears Supabase session and
  returns to `/`.

---

## 4. Navigation Structure

Sidebar groups (order matters for redirect-target tests):

**Primary nav:** Mail (`/inbox`), Extraction (`/dashboard`), Calendar (`/calendar`).
**Secondary nav:** Drive (`/drive`), Forms (`/forms`), Broadcasting (`/broadcasting`),
WhatsApp (`/whatsapp`), Contacts (`/contacts`).
**Admin only:** Team (`/admin/team`); analytics at `/admin/analytics` (+ per-user `/admin/analytics/[userId]`).
**User menu:** My profile (`/profile`), Sign out.

> Note: **SMS** and **CRM** and **Meetings** pages exist (`/sms`, `/crm`, `/meetings`) and are
> reachable/feature-gated, even though they aren't all in the default sidebar list — tests should
> navigate to them directly by URL where relevant.

Each workspace route has a `loading.tsx` skeleton; tests may need to wait past the skeleton.

---

## 5. Feature Specifications

> For each feature: **Route**, **What it does**, **Key UI**, **Primary flows**, **Edge cases**,
> **External dependencies** (mock these in tests).

### 5.1 Mail / Inbox — `/inbox`
**The flagship feature** (largest page, ~5000 lines). A full Gmail client over the Gmail API.

- **What it does:** Shared/team inbox. List threads, read, reply/reply-all/forward, compose, label,
  archive, delete, search, manage drafts, attachments, and Gmail labels.
- **Key UI:** Thread-list column (~300px) with filter tabs, search bar (`MailSearchBar`),
  reading pane (`EmailHtmlBody`, `GmailInlineReply`), compose dialog (`GmailComposeDialog`),
  label picker/chips, thread actions menu, attachment previews, calendar-invite cards rendered
  inline for invite emails.
- **Primary flows to test:**
  1. Load inbox → threads render; folder counts populate.
  2. Open a thread → messages expand, body renders, attachments listed.
  3. Compose new email → recipients (To/Cc/Bcc), subject, rich-text body, attach file, send.
  4. Reply / Reply-all / Forward from an open thread.
  5. Draft autosave (debounced ~`DRAFT_AUTOSAVE_DELAY_MS`) and resume.
  6. Apply/remove labels; create label; filter by label in sidebar.
  7. Search (with suggestions), archive, delete (incl. batch delete/modify).
  8. Attachment upload limits (`GMAIL_ATTACHMENT_MAX_BYTES`); large files routed to Drive and a
     Drive link appended to the email body.
  9. Email open-tracking pixel (`/api/track/[id]`).
- **External deps:** Gmail API (`/api/gmail/*`), Drive API for large attachments, OpenAI not used here.
- **Edge cases:** missing/expired Gmail token → re-auth prompt; recipient validation
  (`validate-mail-recipients`); empty rich-text body blocked; mailbox migration-not-applied fallback.

### 5.2 Extraction / Dashboard — `/dashboard`
- **What it does:** AI-extracts recruiter **contacts** (names, emails, phones) from a batch of emails.
- **Key UI:** Settings toggles — Gmail **label** to read from, **max emails** count, **skip already
  extracted**, **notify on complete** (browser notification permission). Run button + **progress bar**.
  **Results table** (`ResultsTable`), **job history** (`ExtractionJobHistory`), **Export** (CSV).
- **Primary flows:**
  1. Configure settings → start extraction run → progress bar advances → results populate.
  2. Run banner persists across navigation (`ExtractionRunProvider`/`ExtractionRunBanner`).
  3. Export results to CSV (`/api/export-csv`).
  4. Delete extractions (`/api/delete-extractions`).
  5. Job history shows past runs; open a job (`/api/jobs/[id]`).
- **External deps:** Gmail API (`/api/fetch-emails`), OpenAI (`/api/extract`), Supabase.
- **Edge cases:** token-limit per user (`newTokenLimit` on profile); 0 emails matched; notification
  permission denied; long-running run + navigation.

### 5.3 Calendar — `/calendar`
- **What it does:** Google-Calendar-backed scheduling with FullCalendar UI.
- **Key UI:** Month/week/day views, prev/next/today nav, create-event modal (title, attendees via
  `RecipientField`, time, recurrence presets, Google Meet link), search, free/busy panel
  (`CalendarFreeBusyPanel`), RSVP buttons (`CalendarRsvpButtons`), drag-to-move / resize events.
- **Primary flows:**
  1. Create event with attendees + recurrence → appears on calendar.
  2. Drag/resize event → time updates (`/api/calendar/events/[id]`).
  3. RSVP to an invite (accept/decline/tentative) (`/api/calendar/events/[id]/rsvp`).
  4. Schedule via `/api/calendar/schedule`; free/busy lookup (`/api/calendar/freebusy`).
- **External deps:** Google Calendar API, Google Meet (organizer auth scripts under `scripts/`).
- **Edge cases:** recurrence rule building (`lib/calendar-recurrence`), timezone formatting,
  overlapping events, missing Meet-organizer authorization.

### 5.4 Meetings — `/meetings`
- **What it does:** Tracks meeting URLs, statuses, AI **transcripts** and **summaries**.
- **Key UI:** Meeting list with status badges, transcript/summary panels, refresh, delete,
  "send summary" action.
- **Primary flows:**
  1. List meetings; open one → transcript + summary.
  2. Sync meetings (`/api/meetings/sync`); send summary email (`/api/meetings/send-summary`).
  3. Receive transcript via Fireflies webhook (`/api/webhooks/fireflies`).
- **External deps:** Fireflies (webhook), OpenAI (summaries), email send.

### 5.5 CRM (Leads) — `/crm`
- **What it does:** Sales-style lead pipeline for recruiters/companies.
- **Key concepts:**
  - **Lead types:** `New Lead`, `Regular Recruiter`.
  - **Two funnels (Kanban boards):**
    - New Lead stages: `Awareness → Engagement → Conversion → Retention`.
    - Regular Recruiter stages: `Relationship Mgt → JD Expected → JD Received → Drive Scheduled`.
  - **Lead score:** `Hot` / `Warm` / `Cold`.
  - Each lead: company, contact, email, phone, owner (`staff_name`), `jd_count`, interactions, meetings.
- **Key UI:** Funnel toggle, Kanban columns, lead cards with **advance-stage** control, add-lead
  form (`UserPlus`), interactions list (Call/Email/Meeting/Note), refresh.
- **Primary flows:**
  1. Add lead → appears in correct funnel/stage column.
  2. Advance a lead to the next stage (button disabled on last stage).
  3. Log an interaction (`/api/crm/interactions`).
  4. Edit/delete lead (`/api/crm/leads/[id]`).
  5. Link/view meetings (`/api/crm/meetings`).
- **External deps:** Supabase only.
- **Edge cases:** stage advance at funnel end (no advance); score changes; switching funnels.

### 5.6 SMS — `/sms`
- **What it does:** Two-way SMS threads via **Exotel**, sent from the user's **assigned Exotel
  number** (per-user scoping — see memory: SMS migrated Twilio→Exotel).
- **Key UI:** `SmsMessaging` component — conversation list + thread view + composer. Supports a
  `?peer=<E.164>` deep link to open a specific conversation.
- **Primary flows:**
  1. List conversations (`/api/sms/conversations`) → open thread (`/api/sms/messages`).
  2. Send SMS (`/api/sms/send`) → delivery status updates (`/api/sms/status`).
  3. Deep link `/sms?peer=+91...` opens/creates that thread (peer validated as E.164).
- **External deps:** Exotel SMS API (`/api/exotel/sms`, status webhook).
- **Edge cases:** invalid peer phone ignored; no assigned number; delivery-failed status.

### 5.7 WhatsApp — `/whatsapp`
- **What it does:** One-to-one WhatsApp Business chats via Exotel. Full-page chat UI.
- **Key UI:** `WhatsAppMessaging` — conversation list, message thread with **ticks** (sent/
  delivered/read), composer bar with **emoji picker**, **media attachments** (image/doc), **template**
  panel (for outside-24h-window messages), forward-chat modal. `?peer=` deep link supported.
  Contacts shared with SMS via the **Contact Book** (names instead of numbers).
- **Primary flows:**
  1. List conversations (`/api/whatsapp/conversations`) → open thread (`/api/whatsapp/messages`).
  2. Send text message (`/api/whatsapp/send`); send media (`/api/whatsapp/upload` + send).
  3. Send a **template** message (`/api/whatsapp/templates`) when session window closed.
  4. Mark read (`/api/whatsapp/read`); ticks reflect status.
  5. Forward a message to another contact.
  6. Groups (`/api/whatsapp/groups`), capabilities (`/api/whatsapp/capabilities`).
- **External deps:** Exotel WhatsApp API; media served via `/api/whatsapp/serve-media`.
- **Edge cases:** 24-hour session window (templates required outside it); media type/size limits;
  unsupported message types.

### 5.8 Contacts (Contact Book) — `/contacts`
- **What it does:** Save contact **names** for phone numbers; names then appear in WhatsApp & SMS
  instead of raw numbers. (Feature-gated under the `whatsapp` key.)
- **Key UI:** `ContactBook` — list, add/edit/delete contact (name + phone).
- **Primary flows:** add a contact → verify it surfaces as a name in WhatsApp/SMS threads.

### 5.9 Drive — `/drive`
- **What it does:** Full Google Drive file manager (largest non-inbox page, ~2600 lines).
- **Key UI:** Folder breadcrumb navigation, file/folder list, search, refresh, **upload** (chunked,
  with progress queue `DriveUploadQueue`), **share** modal (`DriveShareModal` — manage permissions),
  **move** modal (`DriveMoveModal`), **details** panel, in-app preview for supported types, download
  (files and folder-as-zip), copy, shared-drives selector.
- **Primary flows:**
  1. Browse folders (breadcrumbs), open folder, go back.
  2. Upload file(s) → progress → appears in list (chunked upload via `/api/drive/upload-chunk`,
     `/api/drive/upload-session`).
  3. Share file → add/remove permission (`/api/drive/file/[id]/permissions`).
  4. Move file (`/api/drive/files`), copy (`/api/drive/file/[id]/copy`).
  5. Download file (`/api/drive/file/[id]`) and folder zip (`/api/drive/folder/[id]/download`).
  6. Preview supported file in-app; Office files handled specially.
  7. Switch shared drive (`/api/drive/drives`).
- **External deps:** Google Drive API.
- **Edge cases:** large-file chunked upload resume/cancel; unsupported preview type; permission errors;
  empty folder.

### 5.10 Forms — `/forms` and `/forms/[formId]/edit`
- **What it does:** Create/edit Google-Forms-style forms and view responses.
- **Key UI:** Forms list with search, **create form** (title), **open by link/ID** input, per-form
  **editor** (`FormEditor`) at `/forms/[formId]/edit`, responses view.
- **Primary flows:**
  1. Create form (`/api/forms`) → navigate to editor.
  2. Edit form fields → save (`/api/forms/[formId]/save`).
  3. View responses (`/api/forms/[formId]/responses`), open a single response.
  4. Open existing form by URL/ID (`/api/forms/lookup`).
- **External deps:** Google Forms/Drive API.

### 5.11 Broadcasting — `/broadcasting`
- **What it does:** Bulk outreach across channels. Tabs: **Mail** (with **Mail Merge** sub-view)
  and **WhatsApp**; SMS broadcast reachable via `?channel=sms`.
- **Key UI:** Channel tabs, recipient parsing (paste emails/phones → parsed/validated), attachments,
  message body, mail-merge field mapping (`MailMergePanel`), `WhatsAppBroadcastPanel`,
  `SmsBroadcastPanel`. Channel is reflected in the URL query (`?channel=`).
- **Primary flows:**
  1. Email broadcast: paste recipients (`/api/broadcast/parse-emails`) → compose → send
     (`/api/broadcast/email`).
  2. Mail merge: upload CSV/sheet (`/api/broadcast/parse-mail-merge`) → map fields → send
     (`/api/broadcast/mail-merge`).
  3. WhatsApp broadcast: parse phones (`/api/broadcast/parse-phones` / `parse-wa-merge`) → send
     (`/api/broadcast/whatsapp`).
  4. SMS broadcast (`/api/broadcast/sms`).
- **Edge cases:** invalid recipients filtered with feedback; large recipient lists; per-channel
  feature gating (a user with `whatsapp` restricted can't use the WhatsApp tab — middleware 403).

### 5.12 Profile — `/profile` (`/settings` redirects here)
- **What it does:** User updates display name, password, and views mailbox/line assignment.
- **Key UI:** `ProfileSettings` — display name (`/api/me/display-name`), change password
  (`/api/me/password`), profile (`/api/me/profile`). Shows assigned mailbox + Exotel line.
- **Primary flows:** update display name; change password (validation on length/match);
  verify changes persist after reload.

### 5.13 Admin — Team — `/admin/team` (admin only)
- **What it does:** Manage staff/committee accounts, access groups, and Exotel number assignments.
- **Key UI:** Create-member form (email, password, display username, job title, group, token limit,
  mobile phone, Exotel number). Members list with edit/save/delete and reset-password.
  **Access groups** panel (`AdminGroupsPanel`) — create groups and toggle **restricted features**
  (manageable set: inbox, drive, forms, broadcasting, dashboard, calendar, whatsapp). Exotel number
  picker (only unassigned numbers selectable).
- **Primary flows:**
  1. Create staff member → appears in list; can sign in with given credentials.
  2. Assign/reassign Exotel number (`/api/admin/exotel-numbers`); assigned numbers excluded from picker.
  3. Create access group + toggle feature restrictions (`/api/admin/groups`) → assigned members lose
     access (verify via middleware redirect/403 for that member).
  4. Reset a member's password; delete a member (`/api/admin/staff-users`, `/api/admin/team-members`).
- **External deps:** Supabase (service-role), Exotel (balance check `/api/admin/exotel-balance`),
  OpenAI balance (`/api/admin/openai-balance`).
- **Access:** non-admin → blocked by middleware. Note: on subdomain admin deployments certain fields
  (OpenAI, mobile, Exotel) are hidden (recent commit).

### 5.14 Admin — Analytics — `/admin/analytics` (+ `/[userId]`) (admin only)
- **What it does:** Usage and cost analytics across calls, WhatsApp, email, and OpenAI tokens.
- **Key UI:** Date-range picker (`DateRangePicker`), totals cards (calls in/out/failed, talk minutes,
  WhatsApp sent/received, emails sent, tokens in/out), **cost in INR** (calls, WhatsApp utility/
  promotional/session msgs), per-day time series, per-user drill-down (`/[userId]`).
- **Primary flows:** select date range → totals + charts update (`/api/admin/analytics`); open a user.
- **Edge cases:** empty range; cost formatting (`₹`, en-IN locale).

### 5.15 Calls (no dedicated page; API + embedded UI)
- **What it does:** Outbound/inbound calls with recordings and AI transcripts via Exotel (Twilio legacy).
- **APIs:** `/api/calls` (list), `/api/calls/connect` (place call), `/api/calls/status`,
  `/api/calls/refresh`, `/api/calls/transcribe`, `/api/calls/recording/[recordingSid]`.
- **Flows to test (where surfaced in CRM/contact UIs):** initiate call from a contact; recording
  playback; transcript generation.
- **External deps:** Exotel voice (+ legacy Twilio `/api/twilio/*`), OpenAI transcription, push
  notifications for incoming calls (`/api/push/*`).

---

## 6. Cross-Cutting Behaviors to Test

1. **Auth guard:** every `(workspace)` route redirects unauthenticated users to `/`.
2. **Feature gating:** verify each restricted role gets a redirect (pages) or 403 (APIs) per Section 2.
3. **Nav rendering:** sidebar appears only after `/api/me/mailbox` resolves; restricted features are
   hidden from the sidebar.
4. **Loading skeletons:** each route shows a skeleton then content; tests wait for content markers.
5. **Deep links / query params:** `/sms?peer=`, `/whatsapp?peer=`, `/broadcasting?channel=`,
   `/forms/[formId]/edit`, `/admin/analytics/[userId]`.
6. **Title-casing:** much UI text is passed through `titleCase()` — assert on normalized text.
7. **Error surfaces:** API failures render inline red error boxes / toasts (`AdminToast`); assert
   message text.
8. **Persistent shell:** navigation between tabs does not re-mount `AppShell` (no full reload).
9. **Mobile/responsive:** layouts collapse (e.g. WhatsApp full-height, inbox single-column) — include
   viewport-based tests if mobile is in scope.

---

## 7. External Dependencies & Test Strategy

| System | Used by | Recommended test approach |
|---|---|---|
| Supabase Auth/DB | everything | Use a dedicated **test project** with seeded users per role; or stub network at the Playwright route layer. |
| Gmail API | Inbox, Extraction, Forms, Broadcasting | **Mock `/api/gmail/*`** responses for deterministic E2E. |
| Google Drive API | Drive, large attachments, Forms | Mock `/api/drive/*`. |
| Google Calendar | Calendar | Mock `/api/calendar/*`. |
| OpenAI | Extraction, summaries, transcription | Mock `/api/extract`, `/api/meetings/*`, `/api/calls/transcribe`. |
| Exotel (SMS/WhatsApp/Voice) | SMS, WhatsApp, Calls, Analytics | Mock `/api/exotel/*`, `/api/sms/*`, `/api/whatsapp/*`, `/api/calls/*`. |
| Fireflies | Meetings | Mock the webhook payload. |

**Recommendation:** prefer **route interception/mocking** (`page.route('**/api/**', ...)`) for fast,
deterministic UI tests, plus a **smaller live/integration suite** against a seeded Supabase test
project for auth + access-control correctness.

---

## 8. Test User Setup (fixtures the suite needs)

Create seeded fixtures:
- **Admin** (Google OAuth — note OAuth is hard to automate; consider seeding an admin **session
  cookie** directly, or a password-based admin for tests).
- **Staff** (email+password) with full access.
- **Committee — restricted** (e.g. `restricted_features = ["whatsapp","sms"]`) to test gating.
- **Committee — in an access group** whose `restricted_features` block some features.
- A deployment variant with `NEXT_PUBLIC_ALLOWED_FEATURES` set, to test the domain cap.
- Seed sample data: a few inbox threads (mocked), CRM leads in each stage, contacts, an Exotel
  number assignment, one form, one meeting with a summary.

---

## 9. Recommended `data-testid`s to Add (for stable selectors)

The app currently has none. Adding these would make tests far more robust:

- **Auth:** `auth-google-btn`, `auth-email-input`, `auth-password-input`, `auth-signin-btn`,
  `auth-magic-toggle`, `auth-error-banner`.
- **Sidebar:** `nav-inbox`, `nav-dashboard`, `nav-calendar`, `nav-drive`, `nav-forms`,
  `nav-broadcasting`, `nav-whatsapp`, `nav-contacts`, `nav-admin-team`, `user-menu`, `signout-btn`.
- **Inbox:** `thread-list`, `thread-item`, `compose-btn`, `compose-to`, `compose-subject`,
  `compose-body`, `compose-send`, `reply-btn`, `label-picker`.
- **Dashboard:** `extract-run-btn`, `extract-progress`, `results-table`, `export-csv-btn`.
- **CRM:** `crm-funnel-toggle`, `crm-stage-column`, `crm-lead-card`, `crm-add-lead`, `crm-advance-stage`.
- **SMS/WhatsApp:** `conversation-item`, `message-composer`, `send-btn`, `template-panel`, `wa-tick`.
- **Drive:** `drive-upload-btn`, `drive-file-row`, `drive-share-btn`, `drive-breadcrumb`.
- **Forms:** `forms-create-btn`, `form-row`, `form-save-btn`.
- **Broadcasting:** `broadcast-channel-mail`, `broadcast-channel-whatsapp`, `broadcast-recipients`,
  `broadcast-send`.
- **Admin:** `admin-create-member`, `admin-member-row`, `admin-group-row`, `admin-feature-toggle`.

---

## 10. Suggested Priority for Test Authoring

1. **P0 — Auth & access control** (Sections 2–3): sign-in methods, role-based gating, redirects,
   API 403s. Highest risk, highest value.
2. **P0 — Inbox** core flows (read, compose, send, reply, label).
3. **P1 — CRM** pipeline (add lead, advance stage, log interaction).
4. **P1 — Drive** (browse, upload, share).
5. **P1 — SMS & WhatsApp** (list, open, send, templates, deep links).
6. **P2 — Calendar, Meetings, Forms, Broadcasting, Extraction**.
7. **P2 — Admin** (create member, groups/restrictions, analytics).
8. **P3 — Profile**, responsive/mobile, error surfaces.

---

*End of PRD. Generated from a full codebase review (Next.js App Router, `app/`, `components/`,
`lib/`, `middleware.ts`).*
