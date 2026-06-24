# Placecom — Mail Functionality Test Plan

## Application Overview

Placecom is a placement-operations workspace with a Gmail-backed **Mail / Inbox** (`/inbox`) as the default post-login landing page. Mail functionality spans shared inbox reading and sending, AI contact **Extraction** (`/dashboard`), **Broadcasting** (mail channel at `/broadcasting?channel=mail`), and **Profile** mailbox assignment display (`/profile`). Access is governed by the `inbox`, `dashboard`, and `broadcasting` feature keys via middleware (page redirects and API 403s).

This plan covers mail-related flows only. Tests use Playwright with `page.route()` mocks for Gmail and related APIs, seeded Supabase users, and selector strategies based on visible text, ARIA roles, and placeholders. Several `data-testid` attributes already exist in the codebase (auth, inbox compose, broadcasting, extraction); additional recommended IDs from PRD Section 9 are noted per scenario.

**Note:** Live UI exploration was not performed — the app was unreachable at `http://localhost:3000` during planning. Selectors are derived from the PRD and codebase (`app/(workspace)/inbox/page.tsx`, `components/GmailComposeDialog.tsx`, etc.).

---

## Test Environment & Fixtures

| Item | Value |
|---|---|
| **Base URL** | `http://localhost:3000` (or `PLAYWRIGHT_BASE_URL` env) |
| **Seed file** | `seed.spec.ts` — must be extended with auth fixture: log in as **staff** user (email+password), wait for `/api/me/mailbox` to resolve, then navigate to `/inbox` |
| **Seed users** | **staff** (full mail access), **committee-restricted-inbox** (`restricted_features` includes `inbox`), **committee-restricted-broadcasting**, **admin** (optional; OAuth hard to automate — prefer session cookie injection) |
| **Domain-cap variant** | Deployment with `NEXT_PUBLIC_ALLOWED_FEATURES` excluding `inbox` (e.g. `drive,forms,calendar`) |
| **Mock strategy** | `page.route('**/api/gmail/**', ...)` for threads, labels, send, drafts, folder-counts, search/suggest, history, attachments. Mock `/api/me/mailbox`, `/api/fetch-emails`, `/api/extract`, `/api/broadcast/*`, `/api/export-csv`, `/api/drive/upload-for-email`, `/api/track/*` as needed per scenario |

### Recommended mock payloads (minimal)

- **`GET /api/me/mailbox`**: `{ role: "staff", mailboxEmail: "team@example.com", restrictedFeatures: [] }`
- **`GET /api/gmail/threads?labelId=INBOX`**: `{ threads: [{ id, snippet, subject, from, date, unread, hasAttachment }] }`
- **`GET /api/gmail/threads/:id`**: `{ messages: [{ id, from, to, subject, bodyHtml, attachments, calendarInvite? }] }`
- **`GET /api/gmail/folder-counts`**: counts for INBOX, SENT, DRAFT, etc.
- **`GET /api/gmail/labels`**: system + user labels
- **`POST /api/gmail/send`**: `{ messageId, threadId }`

---

## Assumptions & Prerequisites

1. Fresh browser context per test (no persisted drafts unless scenario requires it).
2. Tests wait for sidebar nav to appear after `/api/me/mailbox` resolves — do not assert on nav before this.
3. Gmail API responses are mocked unless running a dedicated integration suite.
4. Staff test user has a linked mailbox (`mailboxEmail` non-null) unless testing "Not linked yet" states.
5. `titleCase()` is applied to much UI text — assert case-insensitively or match normalized strings (e.g. "Reply All" may render as "Reply all").
6. Inbox layout: desktop shows left rail (Compose + folders + labels); mobile may use alternate controls — viewport 1280×720 recommended for desktop mail tests.
7. Draft autosave debounce is ~2000 ms (`DRAFT_AUTOSAVE_DELAY_MS`); tests must wait accordingly.
8. Large attachment threshold: 25 MB (`GMAIL_ATTACHMENT_MAX_BYTES`).

---

## Test Scenarios

### 1. Authentication — Mail Landing & Nav Readiness

#### 1.1 Staff password sign-in redirects to inbox
**Priority:** P0  
**Seed:** `seed.spec.ts` (extend with staff credentials)  
**Preconditions:** User is signed out; staff account exists with `inbox` feature allowed.  
**Steps:**
1. Navigate to `/`.
2. Fill email (`data-testid="auth-email-input"` or placeholder `you@company.com`).
3. Fill password (`data-testid="auth-password-input"`).
4. Click **Sign In** (`data-testid="auth-signin-btn"`).
5. Wait for URL to be `/inbox`.
6. Wait for sidebar link **Mail** to become visible (post-`/api/me/mailbox`).

**Expected Results:**
- URL is `/inbox`.
- Workspace shell loads; sidebar **Mail** nav item is visible.
- Inbox thread list or empty state renders (not perpetual skeleton).

**Mocks/APIs:** Real Supabase auth (test project) or session cookie injection. Mock `/api/gmail/*` for inbox content.  
**Edge cases / negative tests:** Wrong credentials show error in red box; empty email → "Enter your email."; empty password → "Enter your password."

**Recommended `data-testid`s:** `auth-error-banner` (if not present).

---

#### 1.2 Already-signed-in visitor to `/` redirects to inbox
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Valid Supabase session cookie for staff user.  
**Steps:**
1. Navigate to `/`.
2. Observe brief inbox-shaped skeleton.
3. Wait for redirect.

**Expected Results:**
- Browser lands on `/inbox` via `window.location.replace("/inbox")`.
- No sign-in form shown.

**Mocks/APIs:** Pre-seed session; mock `/api/me/mailbox`.  
**Edge cases / negative tests:** Expired session → sign-in page shown instead.

---

#### 1.3 Sidebar hidden until mailbox API resolves
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Authenticated staff user; `/api/me/mailbox` artificially delayed.  
**Steps:**
1. Log in and navigate toward workspace.
2. Delay `/api/me/mailbox` response by 2 s via route handler.
3. Assert sidebar nav is not visible immediately after shell mount.
4. Release mock response.
5. Assert **Mail**, **Extraction**, etc. appear.

**Expected Results:**
- Nav does not flash restricted features before mailbox resolves.
- After response, primary nav items render.

**Mocks/APIs:** Controlled delay on `**/api/me/mailbox`.  
**Edge cases / negative tests:** Mailbox API 500 → error state (profile/shell handles gracefully).

---

#### 1.4 Mail nav item hidden when `inbox` feature restricted
**Priority:** P0  
**Seed:** `seed.spec.ts` (committee user with `restricted_features: ["inbox"]`)  
**Preconditions:** Committee user signed in; first allowed feature is e.g. `dashboard`.  
**Steps:**
1. Sign in as restricted committee user.
2. Wait for sidebar after `/api/me/mailbox`.
3. Inspect primary nav links.

**Expected Results:**
- **Mail** link is absent from sidebar.
- Direct navigation to `/inbox` redirects to first accessible workspace path (e.g. `/dashboard`).

**Mocks/APIs:** `/api/me/mailbox` returns `restrictedFeatures: ["inbox"]`.  
**Edge cases / negative tests:** N/A.

**Recommended `data-testid`s:** `nav-inbox`.

---

### 2. Access Control — Mail Feature Gating

#### 2.1 Restricted user blocked from `/inbox` page
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Committee user with `inbox` in `restricted_features`.  
**Steps:**
1. Sign in as restricted user.
2. Navigate directly to `/inbox`.

**Expected Results:**
- HTTP redirect away from `/inbox` to first allowed route.
- No inbox thread list rendered.

**Mocks/APIs:** `/api/me/mailbox` with restrictions.  
**Edge cases / negative tests:** Verify redirect target matches sidebar first item order (Mail → Extraction → Calendar → …).

---

#### 2.2 Restricted user receives 403 on Gmail API
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Committee user with `inbox` restricted; authenticated session.  
**Steps:**
1. Sign in and stay on allowed page (e.g. `/dashboard`).
2. `page.request.get('/api/gmail/threads')` or trigger fetch from devtools context.

**Expected Results:**
- Response status `403`.
- JSON body: `{ "error": "This feature is disabled by your admin for your access group." }`

**Mocks/APIs:** No Gmail mock — test real middleware.  
**Edge cases / negative tests:** Admin never restricted even with group restrictions.

---

#### 2.3 Domain cap blocks inbox when not in `NEXT_PUBLIC_ALLOWED_FEATURES`
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** App deployed/run with `NEXT_PUBLIC_ALLOWED_FEATURES=drive,forms,calendar` (no `inbox`); staff user signed in.  
**Steps:**
1. Sign in as staff with full profile access.
2. Navigate to `/inbox`.
3. Call `GET /api/gmail/threads` via API request.

**Expected Results:**
- Page redirect to first allowed feature (not `/inbox`).
- API returns `403` with `{ "error": "This feature is not available on this portal." }`

**Mocks/APIs:** Environment variable on test server; real middleware.  
**Edge cases / negative tests:** Applies to admin role as well when domain-capped.

---

#### 2.4 Staff with full access can open inbox and Gmail APIs
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Staff user; no restrictions; domain cap includes `inbox`.  
**Steps:**
1. Sign in and navigate to `/inbox`.
2. Wait for thread list (`data-testid` folder nav or thread rows).
3. Verify `GET /api/gmail/threads` returns 200 (via network or mock fulfillment).

**Expected Results:**
- `/inbox` loads without redirect.
- Thread list populates from mocked Gmail data.

**Mocks/APIs:** Full Gmail thread list mock.  
**Edge cases / negative tests:** N/A.

---

### 3. Inbox — Load, Folders & Thread List

#### 3.1 Load inbox with thread list and folder counts
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Staff signed in on `/inbox`; Gmail mocks return 3+ threads and folder counts.  
**Steps:**
1. Navigate to `/inbox` after login.
2. Wait past loading skeleton.
3. Observe left rail folder buttons (`data-testid="inbox-folder-inbox"`, `inbox-folder-sent`, `inbox-folder-drafts`).
4. Verify thread rows appear in list column.

**Expected Results:**
- **Inbox** folder shows unread/total badge when mock counts > 0.
- Thread subjects/snippets visible in list.
- **Compose** button visible (`data-testid="inbox-compose-btn"`).

**Mocks/APIs:** `GET /api/gmail/threads`, `GET /api/gmail/folder-counts`, `GET /api/gmail/labels`.  
**Edge cases / negative tests:** Empty inbox → empty state message, zero badges.

**Recommended `data-testid`s:** `thread-list`, `thread-item`.

---

#### 3.2 Switch mail folders (Sent, Drafts, Starred)
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** On `/inbox`; mocks return different thread sets per `labelId`.  
**Steps:**
1. Click **Sent** (`data-testid="inbox-folder-sent"`).
2. Verify list refreshes with sent threads.
3. Click **Drafts** (`data-testid="inbox-folder-drafts"`).
4. Verify draft threads shown.

**Expected Results:**
- Active folder highlighted in left rail.
- API called with correct label/folder param.
- Thread list content changes per folder.

**Mocks/APIs:** Route handler switches payload by query `labelId`.  
**Edge cases / negative tests:** API error → inline error banner.

---

#### 3.3 Refresh inbox thread list
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** On `/inbox` with initial thread mock.  
**Steps:**
1. Update mock to return additional thread.
2. Click refresh (`data-testid="inbox-refresh-btn"`, title **Refresh**).
3. Wait for list update.

**Expected Results:**
- Refresh icon spins during fetch.
- New thread appears in list.

**Mocks/APIs:** `GET /api/gmail/threads` called again; optional `GET /api/gmail/history`.  
**Edge cases / negative tests:** Refresh during open thread preserves or clears selection per product behavior.

---

#### 3.4 Filter threads by user label in sidebar
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Mock labels include user label `Recruiters` with id `Label_1`.  
**Steps:**
1. On `/inbox`, locate **Labels** section in left rail.
2. Click user label **Recruiters**.
3. Wait for filtered thread list.

**Expected Results:**
- Only threads with that label shown.
- Label row appears active/selected.

**Mocks/APIs:** `GET /api/gmail/threads?labelIds=Label_1`.  
**Edge cases / negative tests:** Label with zero threads → empty list state.

---

### 4. Inbox — Read Thread, Attachments & Calendar Invites

#### 4.1 Open thread and read message body
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Thread list mock with thread `thread-1`; detail mock returns 2 messages.  
**Steps:**
1. Click first thread in list.
2. Wait for reading pane.
3. Verify subject heading and message bodies render.

**Expected Results:**
- Subject displayed in reading pane header.
- Message count badge if multiple messages.
- HTML body rendered in reading pane (`EmailHtmlBody`).

**Mocks/APIs:** `GET /api/gmail/threads/thread-1`.  
**Edge cases / negative tests:** Thread with no messages → "No messages in thread."

**Recommended `data-testid`s:** `thread-item` on list rows.

---

#### 4.2 View and download attachments on a message
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Thread detail includes attachment `{ filename: "resume.pdf", mimeType: "application/pdf" }`.  
**Steps:**
1. Open thread with attachment.
2. Locate attachment chip/link in message.
3. Click attachment (or verify `aria-label` **Has attachment** in list row).

**Expected Results:**
- Attachment filename visible.
- Click triggers fetch to `/api/gmail/attachment?messageId=...` (mock returns file bytes or redirect).

**Mocks/APIs:** `GET /api/gmail/attachment`.  
**Edge cases / negative tests:** Multiple attachments all listed.

---

#### 4.3 Calendar invite card renders inline
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** Message mock includes calendar invite metadata (ICS/part).  
**Steps:**
1. Open thread containing calendar invite email.
2. Locate calendar event card (icon/title **Calendar event** in list or inline card in body).

**Expected Results:**
- Invite details (title, time) visible inline.
- Card distinguishable from plain text body.

**Mocks/APIs:** Thread detail with `calendarInvite` or ICS HTML snippet.  
**Edge cases / negative tests:** Non-invite HTML does not show calendar card.

---

#### 4.4 Star and mark important on thread
**Priority:** P2  
**Seed:** `seed.spec.ts`  
**Preconditions:** Thread list with unstarred thread.  
**Steps:**
1. Hover thread row or open thread actions.
2. Click star (`aria-label="Star"`).
3. Click important marker (`aria-label="Mark as important"`).

**Expected Results:**
- Star fills yellow; API modify called.
- Important state toggles.

**Mocks/APIs:** `POST /api/gmail/threads/batch-modify` or thread modify endpoint.  
**Edge cases / negative tests:** Unstar returns to default state.

---

### 5. Inbox — Compose & Send

#### 5.1 Compose new email with To, subject, body, and send
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** On `/inbox`; compose dialog available.  
**Steps:**
1. Click **Compose** (`data-testid="inbox-compose-btn"`).
2. Fill **Recipients** placeholder field with `recruiter@example.com`.
3. Fill **Subject** with `Test placement outreach`.
4. Fill **Compose email** body with rich text.
5. Click **Send** button in compose footer.

**Expected Results:**
- Compose window title **New Message**.
- Send calls `POST /api/gmail/send` with to, subject, textBody/htmlBody.
- Success: compose closes or shows sent confirmation; thread appears in Sent.

**Mocks/APIs:** `POST /api/gmail/send` → 200.  
**Edge cases / negative tests:** See 5.2–5.4.

**Recommended `data-testid`s:** `compose-to`, `compose-subject`, `compose-body`, `compose-send`.

---

#### 5.2 Compose with Cc and Bcc recipients
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Compose open.  
**Steps:**
1. Open compose; expand Cc/Bcc if collapsed.
2. Add Cc: `cc@example.com`, Bcc: `bcc@example.com`.
3. Complete subject/body and send.

**Expected Results:**
- Cc/Bcc fields accept comma-separated addresses.
- Send payload includes `cc` and `bcc`.

**Mocks/APIs:** Assert request body on `POST /api/gmail/send`.  
**Edge cases / negative tests:** Invalid Cc address blocked (see 5.3).

---

#### 5.3 Recipient validation — empty To and malformed address
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Compose open.  
**Steps:**
1. Leave To empty; click **Send**.
2. Verify error: `Please specify at least one recipient.`
3. Enter `not-an-email` in To; click **Send**.
4. Verify error mentions address not recognized in **To** field.

**Expected Results:**
- Send blocked client-side (`validate-mail-recipients`).
- Inline `composeFieldError` displayed; no API call.

**Mocks/APIs:** No send mock should be hit.  
**Edge cases / negative tests:** Same validation on Cc/Bcc fields.

---

#### 5.4 Empty rich-text body blocked on send
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Compose open with valid To and subject.  
**Steps:**
1. Leave body empty (or whitespace-only HTML).
2. Click **Send**.

**Expected Results:**
- Send prevented with validation message.
- No `POST /api/gmail/send` request.

**Mocks/APIs:** None.  
**Edge cases / negative tests:** Body with only `<br>` treated as empty.

---

#### 5.5 Attach file to outgoing email
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Compose open; file under 25 MB.  
**Steps:**
1. Click **Attach files** (`title="Attach files"` in compose footer).
2. Upload `test.pdf` via file chooser.
3. Verify attachment chip in compose.
4. Send email.

**Expected Results:**
- Attachment listed before send.
- Send payload includes base64 attachment or staged draft attachment refs.

**Mocks/APIs:** `POST /api/gmail/send` or draft attachment chunk endpoints.  
**Edge cases / negative tests:** See 5.6 for large files.

---

#### 5.6 Large attachment routed to Drive link in body
**Priority:** P2  
**Seed:** `seed.spec.ts`  
**Preconditions:** Compose open; file > 25 MB (or mock triggers Drive path).  
**Steps:**
1. Attach oversized file.
2. Observe upload progress and **Drive link** chip (`GmailPendingAttachments`).
3. Send email.

**Expected Results:**
- File not sent as Gmail attachment; uploaded via `/api/drive/upload-for-email`.
- Email body or attachment area shows Drive link label.
- Send succeeds with link in body.

**Mocks/APIs:** `POST /api/drive/upload-for-email` → `{ url, fileId }`; `POST /api/gmail/send`.  
**Edge cases / negative tests:** Drive upload failure shows error; token expired during upload.

---

### 6. Inbox — Reply, Reply-All & Forward

#### 6.1 Reply to an open thread
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Thread `thread-1` open with inbound message from `sender@example.com`.  
**Steps:**
1. Click **Reply** in reading pane (`GmailInlineReply` or thread actions menu).
2. Verify compose title **Reply** and To prefilled.
3. Enter body and click **Send**.

**Expected Results:**
- `inReplyToMessageId` and `threadId` sent to API.
- Compose kind is reply; subject prefixed with `Re:`.

**Mocks/APIs:** `POST /api/gmail/send` with threadId.  
**Edge cases / negative tests:** N/A.

**Recommended `data-testid`s:** `reply-btn`.

---

#### 6.2 Reply-all includes all recipients
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Thread with multiple To/Cc recipients.  
**Steps:**
1. Click **Reply all**.
2. Inspect To and Cc fields.
3. Send with body.

**Expected Results:**
- All original recipients (except self) in To/Cc.
- API send includes expanded recipient lists.

**Mocks/APIs:** `POST /api/gmail/send`.  
**Edge cases / negative tests:** Single-recipient thread behaves like Reply.

---

#### 6.3 Forward message with original content
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Thread open.  
**Steps:**
1. Click **Forward** (inline or `ThreadActionsMenu`).
2. Enter new recipient `forward@example.com`.
3. Send.

**Expected Results:**
- Compose title **Forward**.
- Subject prefixed `Fwd:`; original message quoted in body.
- New thread or forward sent via API.

**Mocks/APIs:** `POST /api/gmail/send` without prior threadId or with forward semantics.  
**Edge cases / negative tests:** Forward with attachments carries attachment refs.

---

### 7. Inbox — Draft Autosave & Resume

#### 7.1 Draft autosaves while composing
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** New compose open.  
**Steps:**
1. Enter To and partial body text.
2. Wait ≥ 2.5 s (debounce `DRAFT_AUTOSAVE_DELAY_MS`).
3. Observe draft save indicator (`ComposeDraftSaveIndicator`).

**Expected Results:**
- `POST /api/gmail/drafts` or `PUT` called with draft content.
- Indicator shows saved state (not perpetual "idle").

**Mocks/APIs:** `POST /api/gmail/drafts` → `{ draftId }`.  
**Edge cases / negative tests:** Rapid typing debounces to single save.

---

#### 7.2 Resume draft from Drafts folder
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Mock draft in Drafts folder with saved To/subject/body.  
**Steps:**
1. Navigate to **Drafts** folder.
2. Open draft thread.
3. Verify compose opens with title **Edit Draft** and fields restored.

**Expected Results:**
- Fields match saved draft.
- Further edits trigger autosave to same `draftId`.

**Mocks/APIs:** `GET /api/gmail/drafts?draftId=...`, `GET /api/gmail/threads` for drafts label.  
**Edge cases / negative tests:** Discard draft removes from list.

---

#### 7.3 Close compose saves draft; new Compose opens blank
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** Compose with content open.  
**Steps:**
1. Click **Close** on compose (`aria-label="Close compose"`).
2. Re-open **Compose** from sidebar.

**Expected Results:**
- Previous content saved as draft.
- New **Compose** opens blank **New Message** (not stale draft).

**Mocks/APIs:** Draft save on close.  
**Edge cases / negative tests:** **Discard draft** (trash icon) deletes without saving.

---

### 8. Inbox — Labels

#### 8.1 Apply and remove label on open thread
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Thread open; user label `Recruiters` exists in mock.  
**Steps:**
1. Open label picker on thread (`LabelPicker`).
2. Select **Recruiters**.
3. Verify label chip on thread header.
4. Remove label via chip **×**.

**Expected Results:**
- `POST /api/gmail/threads/:id/labels` with add/remove labelIds.
- Chip appears/disappears in UI.

**Mocks/APIs:** Labels list + thread label modify.  
**Edge cases / negative tests:** N/A.

**Recommended `data-testid`s:** `label-picker`.

---

#### 8.2 Create new user label
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** On `/inbox` left rail **Labels** section.  
**Steps:**
1. Click create label control (title **Create new label**).
2. Enter name in placeholder `Label name…`.
3. Submit/save.

**Expected Results:**
- `POST /api/gmail/labels` called.
- New label appears in sidebar list.

**Mocks/APIs:** `POST /api/gmail/labels` → new label object.  
**Edge cases / negative tests:** Duplicate name shows error.

---

#### 8.3 Batch apply label to selected threads
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** Thread list with 2+ threads; selection checkboxes available.  
**Steps:**
1. Select two threads via checkbox (`aria-label="Select"`).
2. Use batch label action from toolbar.
3. Apply label **Recruiters**.

**Expected Results:**
- Batch modify API called for both thread IDs.
- Labels reflected on threads.

**Mocks/APIs:** `POST /api/gmail/threads/batch-modify`.  
**Edge cases / negative tests:** Select all (`aria-label="Select all"`) applies to visible page.

---

### 9. Inbox — Search, Archive & Delete

#### 9.1 Search mail with query suggestions
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** On `/inbox`.  
**Steps:**
1. Click search field (placeholder **Search mail**).
2. Type `placement`.
3. Wait for suggestions dropdown (`GET /api/gmail/search/suggest?q=placement`).
4. Select a suggestion or press Enter.

**Expected Results:**
- Suggestions list appears while typing.
- Results update to matching threads.
- **Searching…** indicator during fetch.

**Mocks/APIs:** `GET /api/gmail/search/suggest`, `GET /api/gmail/threads` with search query.  
**Edge cases / negative tests:** Clear search (`aria-label="Clear search"`) restores inbox list.

---

#### 9.2 Advanced search options (from, to, excludes)
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** On `/inbox`.  
**Steps:**
1. Click **Show search options** (`aria-label`).
2. Fill **From** `sender@example.com`, **To** `team@example.com`.
3. Run search.

**Expected Results:**
- Composed query sent to Gmail threads API.
- Filtered results match criteria.

**Mocks/APIs:** Threads API with search params.  
**Edge cases / negative tests:** Empty query returns to full folder view.

---

#### 9.3 Archive thread removes from Inbox list
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Thread selected or open in Inbox.  
**Steps:**
1. Select thread.
2. Trigger archive action from thread toolbar/menu.
3. Verify thread removed from Inbox list.

**Expected Results:**
- Batch modify removes `INBOX` label.
- Thread no longer in inbox folder mock response.

**Mocks/APIs:** `POST /api/gmail/threads/batch-modify`.  
**Edge cases / negative tests:** Archive while search active updates results.

---

#### 9.4 Delete single and batch threads
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Multiple threads in list.  
**Steps:**
1. Select one thread; delete via action.
2. Select two threads; batch delete.

**Expected Results:**
- Single delete removes one thread.
- `POST /api/gmail/threads/batch-delete` called for batch.
- Threads disappear from list.

**Mocks/APIs:** Batch delete endpoint.  
**Edge cases / negative tests:** Delete from Drafts folder permanently removes draft.

---

### 10. Inbox — Edge Cases & Error Handling

#### 10.1 Expired Gmail token shows re-auth prompt
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** Staff signed in; Gmail API returns 401.  
**Steps:**
1. Mock `GET /api/gmail/threads` → `{ error: "Google token expired. Sign in again." }` status 401.
2. Navigate to `/inbox`.

**Expected Results:**
- User-visible error banner/message about expired Google token.
- Thread list does not silently fail empty.

**Mocks/APIs:** 401 on gmail routes.  
**Edge cases / negative tests:** Same message on send, labels, and attachment fetch.

---

#### 10.2 Mailbox migration-not-applied fallback
**Priority:** P2  
**Seed:** `seed.spec.ts`  
**Preconditions:** `/api/mailbox/register-session` or mailbox endpoints return `{ skipped: true, reason: "migration_not_applied" }`.  
**Steps:**
1. Sign in and load workspace.
2. Observe mailbox-dependent features.

**Expected Results:**
- App degrades gracefully without crash.
- Profile may show **Not linked yet** for shared mailbox.

**Mocks/APIs:** Mailbox migration skip response.  
**Edge cases / negative tests:** Display name API returns migration message if profiles unavailable.

---

#### 10.3 Email open-tracking pixel endpoint
**Priority:** P2  
**Seed:** `seed.spec.ts`  
**Preconditions:** Tracking enabled; sent email mock includes track id.  
**Steps:**
1. Mock send to insert tracking row id `track-abc`.
2. Request `GET /api/track/track-abc` (simulate pixel load).
3. Verify tracking recorded (mock DB or API response 200 with gif/1x1).

**Expected Results:**
- Pixel endpoint returns successfully.
- Send route embeds tracking URL in HTML body when tracking on.

**Mocks/APIs:** `POST /api/gmail/send`, `GET /api/track/[id]`, `GET /api/gmail/tracking`.  
**Edge cases / negative tests:** Invalid track id returns 404 without error leak.

---

#### 10.4 Unauthenticated workspace route redirects to sign-in
**Priority:** P0  
**Seed:** `seed.spec.ts`  
**Preconditions:** No session cookie.  
**Steps:**
1. Navigate directly to `/inbox`.

**Expected Results:**
- Redirect to `/` sign-in page.
- No inbox content rendered.

**Mocks/APIs:** None.  
**Edge cases / negative tests:** Same for `/dashboard`, `/broadcasting`.

---

### 11. Extraction / Dashboard — Mail-Adjacent Flows

#### 11.1 Configure extraction settings and start run
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** Staff signed in on `/dashboard`; `dashboard` feature allowed.  
**Steps:**
1. Navigate to **Extraction** via sidebar (`/dashboard`).
2. Select Gmail label source (dropdown default **Inbox**).
3. Set max emails count.
4. Toggle **Skip already extracted** and **Notify on complete** if visible.
5. Click **Start Extraction** (`data-testid="extract-run-btn"`).

**Expected Results:**
- Progress bar appears (`data-testid="extract-progress-container"`).
- `/api/fetch-emails` then `/api/extract` called in pipeline.
- Completion banner with processed count.

**Mocks/APIs:** `POST /api/fetch-emails`, `POST /api/extract`, job status endpoints.  
**Edge cases / negative tests:** Zero emails matched → informative completion message.

---

#### 11.2 Extraction progress persists across navigation
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** Long-running extraction mock in progress.  
**Steps:**
1. Start extraction on `/dashboard`.
2. Navigate to `/inbox` via sidebar.
3. Observe `ExtractionRunBanner` in shell.

**Expected Results:**
- Banner shows run in progress.
- Returning to `/dashboard` shows same progress state.

**Mocks/APIs:** Slow mock extract pipeline.  
**Edge cases / negative tests:** Completed run clears banner.

---

#### 11.3 View extraction results and export CSV
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** Completed extraction with results in table.  
**Steps:**
1. On `/dashboard`, wait for **Results** table (`ResultsTable`).
2. Click export control (`ExportButton` / `data-testid="export-csv-btn"` if present).
3. Verify download or `/api/export-csv` call.

**Expected Results:**
- Table shows names, emails, phones from extraction.
- CSV export triggers with correct columns.

**Mocks/APIs:** `GET /api/export-csv` or client-side CSV generation.  
**Edge cases / negative tests:** Export with zero rows disabled or empty file message.

---

#### 11.4 Extraction job history — open past job
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** Mock job history with at least one completed job.  
**Steps:**
1. Scroll to **Job history** (`ExtractionJobHistory`).
2. Click a past job row.
3. Verify job detail loads via `/api/jobs/[id]`.

**Expected Results:**
- History lists date, status, counts.
- Detail shows emails processed and extracted contacts.

**Mocks/APIs:** `GET /api/jobs`, `GET /api/jobs/:id`.  
**Edge cases / negative tests:** Delete all extractions (`data-testid="extract-delete-all-btn"`) clears results after confirm.

---

#### 11.5 Extraction fails on expired Google session
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** `/api/fetch-emails` returns session expired error.  
**Steps:**
1. Start extraction.
2. Wait for error state (`data-testid="extract-error"`).

**Expected Results:**
- Error message: "Your Google session expired. Please sign out and connect Gmail again." (or equivalent).
- Progress stops; no partial false success.

**Mocks/APIs:** 401/403 from fetch-emails.  
**Edge cases / negative tests:** Token limit reached on profile shows allowance message.

---

### 12. Broadcasting — Mail Channel

#### 12.1 Email broadcast — parse recipients, compose, send
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** Staff with `broadcasting` allowed; on `/broadcasting?channel=mail`.  
**Steps:**
1. Navigate to `/broadcasting`; ensure **Mail** tab active (`data-testid="broadcast-tab-mail"`).
2. Ensure **Broadcast** sub-tab selected (`data-testid="broadcast-mail-subtab-broadcast"`).
3. Paste `a@example.com, b@example.com` in manual textarea (`data-testid="broadcast-manual-recipients-input"`); click **Add to list**.
4. Enter subject and body.
5. Click send (`data-testid="broadcast-send-btn"` or **Send** button).

**Expected Results:**
- Recipient list shows 2 emails with count badge.
- `POST /api/broadcast/email` with recipients, subject, textBody.
- Success summary: sent count displayed.

**Mocks/APIs:** `POST /api/broadcast/email` → `{ sent: 2, failed: [] }`.  
**Edge cases / negative tests:** Send with zero recipients → "Add recipients from a file or the manual list."

**Recommended `data-testid`s:** `broadcast-recipients`, `broadcast-send`.

---

#### 12.2 Import recipients from CSV file
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** On mail broadcast view.  
**Steps:**
1. Click **Choose file** (`data-testid="broadcast-import-csv-btn"`).
2. Upload CSV with Email column via mock file input.
3. Wait for parse via `POST /api/broadcast/parse-emails`.

**Expected Results:**
- Parsed emails added to recipient list.
- Invalid file shows parse error message.

**Mocks/APIs:** `POST /api/broadcast/parse-emails`.  
**Edge cases / negative tests:** No emails found → "No email addresses found…" error.

---

#### 12.3 Mail merge — CSV upload, field mapping, send
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** On `/broadcasting?channel=mail`.  
**Steps:**
1. Switch to **Mail merge** sub-tab (`data-testid="broadcast-mail-subtab-merge"`).
2. Upload CSV with columns `email`, `name` via `MailMergePanel` file picker.
3. Verify subject/body templates with `{{name}}` placeholders.
4. Preview merged content for row 1.
5. Send mail merge.

**Expected Results:**
- `POST /api/broadcast/parse-mail-merge` returns rows and columns.
- Preview shows merged subject/body.
- `POST /api/broadcast/mail-merge` sends per-row emails.

**Mocks/APIs:** Parse and mail-merge endpoints.  
**Edge cases / negative tests:** Missing email column → parse error; partial send failures listed in result.

---

#### 12.4 Broadcasting tab hidden when feature restricted
**Priority:** P1  
**Seed:** `seed.spec.ts`  
**Preconditions:** Committee user with `broadcasting` in `restricted_features`.  
**Steps:**
1. Sign in and wait for sidebar.
2. Verify **Broadcasting** nav absent.
3. Navigate to `/broadcasting` directly.
4. Call `POST /api/broadcast/email`.

**Expected Results:**
- Page redirect away from broadcasting.
- API `403` with group restriction message.

**Mocks/APIs:** `/api/me/mailbox` restrictions.  
**Edge cases / negative tests:** Mail channel only — WhatsApp tab out of scope unless gating shared.

---

#### 12.5 Broadcast email with attachment
**Priority:** P2  
**Seed:** `seed.spec.ts`  
**Preconditions:** Recipients added on mail broadcast.  
**Steps:**
1. Attach file under 24 MB via attachment control.
2. Send broadcast.

**Expected Results:**
- Attachment included in `POST /api/broadcast/email` payload.
- File over 24 MB rejected with alert per client validation.

**Mocks/APIs:** `POST /api/broadcast/email` with attachments array.  
**Edge cases / negative tests:** Gmail token expired on send → error surfaced.

---

### 13. Profile — Mailbox Assignment Display

#### 13.1 Profile shows assigned shared mailbox email
**Priority:** P2  
**Seed:** `seed.spec.ts`  
**Preconditions:** Staff user with linked mailbox `team@college.edu`.  
**Steps:**
1. Navigate to **My profile** (`/profile`) via user menu.
2. Wait for profile load (not "Loading profile…").
3. Locate **Account access** section.

**Expected Results:**
- **Shared mailbox** field shows `team@college.edu`.
- **Sign-in email** shows user's auth email (distinct from mailbox).

**Mocks/APIs:** `GET /api/me/profile` → `{ mailboxEmail: "team@college.edu" }`.  
**Edge cases / negative tests:** Unlinked mailbox shows **Not linked yet**.

---

#### 13.2 Profile mailbox display read-only
**Priority:** P2  
**Seed:** `seed.spec.ts`  
**Preconditions:** On `/profile`.  
**Steps:**
1. Verify shared mailbox field is display-only (no edit input).
2. Update display name and save (sanity check page works).

**Expected Results:**
- Mailbox cannot be changed from profile UI.
- Other profile fields remain editable.

**Mocks/APIs:** `PATCH /api/me/display-name`.  
**Edge cases / negative tests:** N/A.

---

## Seed File Notes (`seed.spec.ts`)

The current `seed.spec.ts` is a placeholder. Before implementing mail tests:

1. Add Playwright **auth fixture** (storage state or login helper) for **staff** user.
2. In `test.beforeEach`, call login → wait for `**/api/me/mailbox` → `page.goto('/inbox')`.
3. Register global Gmail API mocks in fixture or per-spec `beforeEach`.
4. Export storage states for `staff`, `committee-restricted-inbox`, and `committee-restricted-broadcasting` to speed up suite runs.

Example seed structure:

```typescript
test('seed', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('auth-email-input').fill(process.env.E2E_STAFF_EMAIL!);
  await page.getByTestId('auth-password-input').fill(process.env.E2E_STAFF_PASSWORD!);
  await page.getByTestId('auth-signin-btn').click();
  await page.waitForURL('**/inbox');
  await page.getByRole('link', { name: /mail/i }).waitFor();
});
```

---

## Scenario Summary

| Priority | Count | Categories |
|---|---|---|
| **P0** | 30 | Auth landing, access control, inbox core (read, compose, send, reply, labels, search, archive, delete, validation, token errors) |
| **P1** | 14 | Refresh, calendar invites, draft close, batch labels, advanced search, extraction, broadcasting |
| **P2** | 7 | Star/important, large attachments, tracking pixel, migration fallback, broadcast attachments, profile mailbox |

**Total: 51 discrete scenarios**

---

*Generated from PRD `docs/PRD-for-test-automation.md` and codebase review. Live UI validation pending — start dev server at `http://localhost:3000` and re-verify selectors before test implementation.*