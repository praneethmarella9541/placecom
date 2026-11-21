# Flexible data model, version 1

Branch `feature/flexible-data-model`, built on `feature/bring-your-own-mailbox`. Migrations 0086 and 0087. The `dataModel` module ships **off** and the tables start empty, so merging changes nothing for users.

## What exists

| Piece | Where |
|---|---|
| Tables: objects, attributes, records, matching keys, lists, stages, entries, edit history | `supabase/migrations/0086_data_model_core.sql` |
| `data_model_seed(org)` and `data_model_backfill(org, dry_run)` | `supabase/migrations/0087_data_model_seed_and_backfill.sql` |
| Value rules per attribute type, key extraction | `lib/data-model/values.ts` (tests: `npm test`) |
| Access (org, role, module switch) | `lib/data-model/access.ts` |
| Record and list queries | `lib/data-model/records.ts`, `lib/data-model/lists.ts` |
| API | `app/api/data/**` (objects, setup, records, lists, stages, entries) |
| Undo and checks | `supabase/rollbacks/0086_data_model_core.{down,verify}.sql` |

Not built: any screen (table view, record page, kanban), custom-object creation, attribute editing, formulas, merge, import, the leads/pipeline copy.

## Choices made (change them if you disagree)

- **Enforcement:** tables are service role only, no RLS policies, every route scopes by the org taken from the signed-in user. Same as the BYOM tables (0084).
- **Tenant:** `org_owner_id`, the same id BYOM uses.
- **Storage:** `name` is a core column; every other value is in one JSONB `values` object keyed by attribute slug. Emails and domains are also written to `data_record_keys`, whose unique index stops two people sharing an email.
- **Access:** admin reads, writes and runs setup. Staff read with any access to the common mailbox and write with reply or full. No per-object or per-list rules yet.
- **Mail:** no mail metadata is stored. The Emails tab is not part of version 1.
- **Stages:** shared per list. The old per-user boards (0055) are not copied.
- **Deletes:** records are soft-deleted; their keys are freed so the email can be reused.

## Turning it on for one org

1. Apply 0086, 0087 and 0088 to staging first. Run `0086_data_model_core.verify.sql`.
2. In `/configs`, switch the `Data model` module on.
3. As the admin: `POST /api/data/setup {"action":"seed"}`, then `{"action":"backfill"}` (a dry run: it writes nothing), then `{"action":"backfill","dryRun":false}`.
4. Compare the counts in verify block 6 before and after; the old tables must be unchanged.

## Known limits

- The SQL in 0086/0087 was written without a database to run it against. Run it on staging and read the dry-run counts before trusting it.
- No transactions in supabase-js: a create or update that fails part-way cleans up after itself, but a crash between steps could leave an unused key. `verify` block 5 finds the opposite case.
- Filtering on a multi-value attribute (emails, phones) matches the stored JSON text.

## Screens (added after the first cut)

| Screen | Route | What it does |
|---|---|---|
| Data | `/data` | Tabs for People, Companies, Deals and Lists. Server-paged table with search, sortable columns, new record. First-run setup and the preview-then-copy panel for admins. |
| Record | `/data/[id]` | Edit the name and every attribute (saves when you leave a field). Add the record to a list. Delete. |
| List board | `/data/lists/[id]` | Stages as columns, drag a card or use its stage dropdown, add a record, add a stage, remove an entry. |

The sidebar shows **Data** under Pipeline only when the `Data model` module is on in `/configs`.

Added since: a **Filter** bar on the table, a **Fields** button (admin) to add or hide custom fields, a team picker for member fields (a deal's owner), and a **History** section on the record page.

Then: **saved views** (migration 0088; personal, or shared with the team by an admin), a **column picker**, **custom objects** (the + tab, admin), **renaming** fields and objects, and **fields on list entries** (Fields button on a list; each card has a Details editor).

Not built yet: deleting a custom object or a view's sharing history, list views, the leads and pipeline copy. A custom object can't be deleted yet; hide its fields or leave it unused.

## Layout (Attio-style, in our own styling)

`/data` has an object rail on the left (People, Companies, Deals, your own objects, then your lists), view tabs above a dense table, type icons in the column headers, chips for links and options, row checkboxes with a bulk "Add to list" bar, and a sticky header. The record page has a details panel on the left and Activity and Lists tabs on the right. Selects share one chevron style (`select-chevron` in `globals.css`).

## Company names

Migration 0089 changes how the copy names new companies: a name typed on a team-directory card first, then the name looked up when the mailbox was synced (logo.dev, else a guess from the domain), then a tidy version of the domain. Companies already created keep their names.

Record deletes and list archives also respect the /configs "Allow delete" switch, as the brief requires.

## Added in the second round (migrations 0090 to 0092)

- **Record page:** tabs for Activity, Notes, Tasks, Emails, Related and Lists; Merge (people and companies).
  - Notes and Tasks are stored (0090). Emails is read live from the mailbox you are working in and nothing is copied (your own mailbox stays yours; the common mailbox follows the access an admin gave you).
  - Related shows records that link to this one (a company's people and deals) and adds or removes the link.
  - Merge keeps the winner's details, combines emails/phones/domains, and moves lists, notes, tasks and links across.
- **Deals pipeline:** `data_model_seed` now creates a "Deals pipeline" list with six shared stages, and new deals join it. Re-run Seed (setup action `seed`) to add it to an existing org.
- **Leads:** 0091 copies the CRM pipeline into a Leads list on People (stages merged by name into one shared set, score and staff as entry fields), and lead interactions and contact-book notes into notes. Setup action `backfill_leads`, previewed first. The "Copy from CRM" button in the Data rail runs both copies.
- **Boards:** time in stage on each card, an optional target time per stage (the card turns red when late), a per-stage total (deal value, or a money field on the entries), and select-many then move.
- **Table:** click a cell to edit it, CSV export of what the table shows, CSV import (map columns, check the first 100 rows, import in batches, download the problem rows), more filters (is not, before/after for dates, "me" for team members).
- **Access:** per-object setting for staff (view and edit / view only / hidden), set by an admin in the Fields dialog (0092). Lists follow their object. Admins always have full access.
- Deleting a record is still behind the /configs "Allow delete" switch; merging is not (it removes the merged-in record, and says so).

## Added in the third round (migration 0093)

- **Validation rules** (admin, the Rules button on a table or a board): "when X, Y is required / must be empty". A record rule is checked whenever a record is saved (screens, import, merge-free edits); a stage rule when a card moves into a stage (a deal's value is required to enter Won). A refused save says which fields. Existing records are not flagged until next saved.
- **Stage history and the funnel report** (the Report button on a board): cards that ever reached each stage, who is where now, average days there, and how many are past the stage's target. History is written from the day 0093 is applied; older cards only count for the stage they are in.
- **From mail** on a person or company: last interaction, connection strength, and mail volume, read from the contact sync. Read-only and as of the last sync.
- **Favourites** (the star on a record or list; they show in the Data rail) and **highlights** (an admin pins up to six fields to the top of every record page).
- **Custom fields** can now be **required** and have a **default value**; both are editable from the Fields dialog. An empty custom object can be **deleted** (behind "Allow delete").

## Still not built

Per-team and per-member access and the own/group/all row rules (need the workspace membership brief), formulas, AI fields, dashboards that combine several reports, mail linking that creates people from mail and blocked or protected contacts, a record preview panel, the Files tab, two-way relationship types, linked-attribute filters, list templates, the Name (first/last), Location and Status types, several entries per record on one list (deliberately left out: the Leads copy relies on one entry per person per list).
