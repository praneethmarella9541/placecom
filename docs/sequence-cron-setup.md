# Wiring the sequence scheduler to cron-job.org

Scheduled sequence emails only go out when something calls
`GET /api/cron/sequences`. Nothing in this repo schedules that call — there is no
`crons` key in `vercel.json`, no GitHub Actions workflow, and no `pg_cron`. Until
the steps below are done, enrollments go due and simply sit there.

## Why cron-job.org, and the one constraint that shapes the setup

cron-job.org is free and allows a job to run **every minute** (60×/hour). The
catch: it **closes the connection after 30 seconds**. Our runner used to budget
240s per tick, which would have been logged as a timeout on every single run.

The fix is already in the code: a tick now budgets ~20s of work
(`DEFAULT_DEADLINE_MS` in `lib/sequence-runner.ts`) and we lean on the 1-minute
cadence instead of one long run. Anything not finished stays due — `releaseClaim`
leaves `next_run_at` untouched — and the next tick picks it up.

Throughput is better this way, not worse:

| Cadence | Budget/tick | Ceiling |
|---|---|---|
| Old design: every 10 min | 240s, 60 sends | ~360 sends/hour |
| This setup: every 1 min | 20s | ~900–1500 sends/hour |

The real ceiling in practice is the per-sequence daily cap and Gmail quota, not
the tick budget.

## Step 1 — Generate a secret

```bash
openssl rand -hex 32
```

Keep the value handy; it goes in two places (Vercel, then cron-job.org). Do not
commit it.

## Step 2 — Set it in Vercel

Vercel dashboard → your project → **Settings → Environment Variables**:

- Name: `CRON_SECRET`
- Value: the string from step 1
- Environments: **Production** (add Preview too if you want to test there)

**Then redeploy.** Env vars are baked in at deploy time — an existing deployment
will not pick this up, and the route keeps returning 503 until you redeploy.

The same secret also authorises `/api/cron/contact-sync`, so if that job is
already running somewhere with a different value, update it too.

## Step 3 — Verify the endpoint before scheduling it

Do a dry run first — this claims and evaluates due enrollments but sends nothing:

```bash
curl -i -H "Authorization: Bearer $CRON_SECRET" \
  "https://www.thenucleus.in/api/cron/sequences?dry=1"
```

| Response | Meaning |
|---|---|
| `200` with `{"ok":true,"dryRun":true,...}` | Working — go to step 4 |
| `503 CRON_SECRET is not configured` | Step 2 missing, or not redeployed since |
| `401 Unauthorized` | Secret mismatch between your shell and Vercel |

## Step 4 — Create the job on cron-job.org

Sign up at https://cron-job.org, then **Create cronjob**:

**Common tab**
- Title: `Sequences scheduler`
- URL: `https://www.thenucleus.in/api/cron/sequences`
- Schedule: **Every 1 minute** (select "Every minute", or custom: minutes `*`)
- Enable job: on

**Advanced tab**
- Request method: **GET**
- Add a custom header:
  - Key: `Authorization`
  - Value: `Bearer <your CRON_SECRET>` — note the literal `Bearer ` prefix and
    the single space
- Treat redirects as success: off
- Notify on failure: on (so a broken secret surfaces instead of failing silently)

Save. cron-job.org supports arbitrary custom headers on the free tier; only
`User-Agent` and `Connection` are ignored.

Put the secret in the **header**, not in a `?secret=` query param — URLs show up
in cron-job.org's execution history and in Vercel's request logs, headers do not.
(`/api/cron/contact-sync` does accept a query param for historical reasons;
`/api/cron/sequences` deliberately does not.)

## Step 5 — Confirm it is actually running

After a few minutes, cron-job.org → the job → **History**. You want status 200
and a duration comfortably under 30s (expect roughly 1–20s depending on how much
is due).

Cross-check the real effect in Supabase:

```sql
-- Should be moving as ticks fire.
select status, count(*) from sequence_sends group by status;

-- Enrollments that are due but never picked up = the cron is not reaching you.
select id, next_run_at, attempt_count, last_error
from sequence_enrollments
where status = 'active' and next_run_at < now()
order by next_run_at
limit 20;
```

## Troubleshooting

| Symptom | Cause |
|---|---|
| Every run times out at 30s | Budget override too high — drop any `?budgetMs=` you added |
| `503` in history | `CRON_SECRET` unset in Vercel, or not redeployed since setting it |
| `401` in history | Header value malformed — must be exactly `Bearer <secret>` |
| 200s, but `sent` is always 0 | Nothing due, outside the sequence's send window, or the daily cap is hit |
| `last_error` mentions tokens/scope | Mailbox refresh token is stale — reconnect that Gmail account |

Duplicate sends are not a risk if a tick overlaps the next one:
`claimDueSequenceEnrollments()` (`lib/sequence-runner.ts`) leases rows via a
conditional per-row `UPDATE` re-checked at write time — see its doc comment
for why this replaced the `claim_due_sequence_enrollments()` Postgres RPC
that migration 0036 originally shipped with (that RPC returned zero rows
through this project's service-role connection for reasons that turned out
to be a PostgREST/platform-level anomaly, not an app bug; a plain SELECT
and a plain UPDATE through the identical connection both worked correctly).
A partial unique index on `sequence_sends (enrollment_id, step_id)` makes a
double send impossible either way, even if a lease is somehow bypassed.
