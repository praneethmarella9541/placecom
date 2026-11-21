# Workflows, version 1

Built on `feature/flexible-data-model`, following the Nucleus Workflows Brief. Migration **0094**. The `workflows` module ships **off** and needs the `dataModel` module on.

## What exists

| Piece | Where |
|---|---|
| Tables: workflows, versions (one draft + numbered published ones), event log, runs, run steps, notifications | `supabase/migrations/0094_workflows_core.sql` |
| Event log: record created/updated, field changed, added to list, list entry changed | `lib/data-model/events.ts`, written from `records.ts` and the list entry routes |
| Worker: matcher, schedule firing, run leasing, block execution, retries, loop guard, daily limit | `lib/workflows/engine.ts`, ticked by `GET /api/cron/workflows` |
| Blocks: filter, if/else, delay, update record, create record, find records, add to list, update list entry, create note, create task, send notification | `lib/workflows/blocks.ts` |
| Triggers: record created, record updated, field changed, added to list, list entry changed, manual, schedule | `lib/workflows/triggers.ts`, `schedule.ts` |
| Variables (`{{trigger.record.name}}`, `{{b2.record.id}}`), conditions | `lib/workflows/template.ts`, `conditions.ts` |
| Block tree rules and builder edits | `lib/workflows/graph.ts` |
| API | `app/api/workflows/**` |
| Screens | `/workflows` (list, notifications), `/workflows/[id]` (Builder and Runs tabs, run viewer) |
| Tests | `npm test` (graph, templates, conditions, triggers, schedule) |

## How it behaves

- **Events first.** Every change a workflow can react to is written to `workflow_events`; a worker turns events into runs. `(workflow, event)` is unique, so an event never starts the same workflow twice.
- **Versions.** The builder edits a draft (autosaved). **Publish** checks it in full and makes it the next numbered version; runs already going finish on the version they began with.
- **Runs.** Every block's settings, result and error are recorded. The run viewer shows the canvas with ticks and a red failed block; retry from the start or from the failed block; cancel.
- **Retries.** A block that fails for a temporary reason retries twice more (1 then 5 minutes); bad input does not retry. A failed run notifies the owner, at most once an hour per workflow.
- **Loop guard.** A workflow that starts 5 times on one record within a minute is turned off and flagged (a workflow that edits the field it listens to).
- **Limits.** 5,000 runs per workspace per day; a block has 60 seconds; 40 blocks per workflow; a delay up to 365 days.
- **Same rules as people.** A workflow writes through the same functions as the screens: validation, record rules, stage rules, history. Its changes are logged as "by workflow".
- **Access.** Admins only: build, publish, run, read runs. A workflow acts as an admin (its owner).

## Turn it on

1. Apply 0094. Run `supabase/rollbacks/0094_workflows_core.verify.sql`.
2. Turn on **Data model** and **Workflows** in `/configs`.
3. **Add a scheduler job.** Create a cron-job.org job (every minute) like the sequence one: `GET https://<app>/api/cron/workflows` with `Authorization: Bearer $CRON_SECRET`. Without it, event-triggered workflows still start shortly after a change (the app nudges the worker), but **delays, retries and schedules only advance when the tick runs**.
4. Try it: `/workflows` → New workflow → trigger "A record is added to a list" → add a **Create task** block → Publish. Add a person to that list; the run appears under Runs within seconds. For a quick manual check: `curl -H "Authorization: Bearer $CRON_SECRET" "https://<app>/api/cron/workflows?wait=1"` answers with a summary.

## Not built yet (from the brief)

- **Blocks:** send email, create draft, enroll in / exit a sequence (phase after shared stages exist), AI classify and the other AI blocks (need the daily AI limit and the mail-privacy rules first), switch, loop, formula, adjust date, aggregate, HTTP request, run JavaScript.
- **Triggers:** webhook received, email or reply received, meeting or call completed, note or task created, button on a record.
- **Access:** workflow access levels (Full / Run only / None), per-object and per-list write grants for a workflow, row rules, workflows owned by non-admins, the "owner leaves" handling.
- **Private mail:** nothing here reads mail, so nothing can leak, but the rule must be built with the email triggers.
- **Engine:** a fair queue per workspace for bulk events (an import of thousands of rows will make runs late for everyone), run-detail retention (90 days), grouped failure notifications for the whole workspace, moving the tick into the platform (Vercel Cron or a Supabase scheduled function) instead of the outside pinger.
- **Builder:** blocks that rejoin after an if/else (paths split but do not join), step-through of loops, warning in the editor when a workflow edits the field it listens to.
