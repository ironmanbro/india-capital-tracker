# Rolling out the alias tables to the live project

Nothing here has been applied. This is the order to do it in, what to check at each step, and how to undo it.
The change is additive: it creates two tables, one view and one function, and alters none of your existing objects
(tested: the inventory of every other table, function and policy is identical before, after and after rollback).

## What was checked on the live project (read-only, 14-Nov-26 about 11:16 UTC)
Project `urpphqybqmxlwhjghsmf` (india-capital-tracker, ap-south-1, Postgres 17.11). Only reads were run: `list_projects`, `list_migrations`, the security advisors, and catalog `select`s.

| Check | Result | Why it matters |
|---|---|---|
| Any `entity_*` object already there | none | nothing to collide with |
| `norm_name(text)` | exists, immutable, search path set, **identical word list** to the migration | the site's key (checked on 14,223 names) equals the database's |
| `is_admin()` | exists; 1 owner account in `app_admins` | the owner-only write policies work |
| `investor_facts` policies | read for everyone, write for the owner | the new tables copy this pattern |
| Default privileges on new tables | anon and authenticated get SELECT by default | the migration revokes all and grants only what it should |
| API role statement timeout | 8 seconds | the site's alias read is a small paged `select`; far below this |
| Migration history | applied with timestamp versions (for example `20261031073252_investor_facts`) | repo filenames differ from live versions; apply through the SQL editor or `apply_migration` |
| Security advisors (baseline) | by finding: 1 ERROR (view `stories` is security definer), 6 INFO (RLS enabled, no policy), 18 WARN (1 function search path, 3 extensions in public, 5 + 8 definer functions callable by anon / signed-in users, 1 leaked-password protection) | after the rollout the counts must be **the same**: the new function and view run with the caller's rights and the new tables have policies |

Tested on PostgreSQL 16.15; live is 17.11. Nothing in the migrations is version-specific, but the first apply is the real test, which is why step 3 re-checks everything.

## Go / no-go
Stop and ask before continuing if any of these is true: a `verify` check fails; the advisor counts change; the SQL editor shows an error (nothing is half-applied, each file is one transaction, but find out why first).

## Steps

### 0. Before you start
```bash
python3 pipeline/aliases/verify_rollout.py --before
```
Expect `4 of 4 checks passed` (it confirms the alias objects do not exist yet; it only reads). It passed on 14-Nov-26.
Keep the JSON export from the review page: it is the backup of your decisions and can rebuild everything.

### 1. Apply the schema (empty tables, no change to the site)
In the Supabase SQL editor, run these one at a time, each as a single run, in this order:
1. `supabase/migrations/20261114_entity_aliases.sql`
2. `supabase/migrations/20261115_entity_companies.sql`

Each should end with "Success". Both are safe to run again (tested: 1, 2, 1, 2, 2 with no errors and the data intact). If you use `apply_migration`, name them `entity_aliases` and `entity_companies`.
If the REST API answers 404 for the new view straight afterwards, reload its schema cache and retry: `notify pgrst, 'reload schema';`

### 2. Check the permissions (you run this; it only reads)
Run `pipeline/aliases/verify_after_apply.sql` in the SQL editor and compare each result with its `-- expect` line.
The ones that matter most: anon can only SELECT; anon cannot insert, update or delete; the function is not `security definer`; the view has `security_invoker=true`.
Then:
```bash
python3 pipeline/aliases/verify_rollout.py --after
```
With empty tables it should pass (it checks the view answers and is well formed). Re-run the security advisors and confirm the counts equal the baseline above.

### 3. Review and export
Open `mockups/v2/alias.html`, review the groups, then **Download decisions (JSON)** and **Download SQL for the database**. Read the SQL file: it creates a temporary table, stops with "Not saved" on any clash, and commits at the end. Excluded names are stored as rejected, so a later export cannot silently turn them back on (the generators do not read these decisions yet, so they may propose the same names again).

### 4. Load the decisions
Run the downloaded SQL file in the SQL editor. Expect `COMMIT`. If you see `Not saved. ...`, nothing was written; the message names the clash (a name in two groups, confirmed and rejected at once, or already in a different group). Fix it in the review page and export again.

### 5. Verify the data
```bash
python3 pipeline/aliases/verify_rollout.py --after --decisions alias-decisions-<date>.json
```
Expect every check to pass: all the names you confirmed are live under the same key, each in the group you chose, and no rejected name or group is readable by the public. Also run section 6 of `verify_after_apply.sql` and compare the counts with the review page's export bar (a pair of spellings with the same key counts once).

### 6. Switch the pages to the database
In `mockups/v2/config.js` change `aliasSource: 'local'` to `'database'`. Open the Investors directory, Deals, Registrations and the two profiles. The line under the page header should say "... from the database", and the numbers should match what you saw while reviewing. If it says "Database unavailable (...)", the page is still working from your local decisions: see Troubleshooting.
The review page always stays on local decisions, so you can keep reviewing while the other pages read the database. The v2 pages are a mockup; `site/` (the live Cloudflare site) is not changed by any of this.

### 7. Afterwards
New decisions: re-run the generators, review, export, run the SQL. The generators do not yet skip names you already decided, so expect to see them in the queue again; confirming the same decision is harmless, and re-running an export changes nothing unless a decision changed. Consider committing each JSON export to the repo as the audit trail.

## Rollback
| If | Do | Loses |
|---|---|---|
| The pages misbehave | set `aliasSource` back to `'local'` | nothing |
| One group is wrong | in the SQL editor: `delete from public.entity_group where kind = 'investor' and canonical = 'THE GROUP';` (its aliases go with it), then fix it in the review page | that group |
| Everything | download the JSON export first, then run `supabase/rollback/20261115_entity_aliases_down.sql` | all stored decisions; they can be rebuilt by re-importing the export |

The rollback file drops the view, the function and both tables in one statement and touches nothing else. Tested: after it, every other object was identical to before, running it twice is harmless, and re-applying the migrations and the exported SQL restored 510 confirmed and 179 rejected aliases.

## Troubleshooting
| You see | Likely cause | Fix |
|---|---|---|
| `Database unavailable (HTTP 404)` | the API has not noticed the new view | `notify pgrst, 'reload schema';` and reload the page |
| `Database unavailable (HTTP 401)` or `permission denied` | grants did not apply | run query 2 of `verify_after_apply.sql`; re-run migration 2 |
| `Database unavailable (the database did not answer in time)` | slow network or paused project | the page falls back after 3 seconds; raise `aliasTimeoutMs` in `config.js` if it is persistent |
| Page says "No aliases confirmed yet" in database mode | the SQL export has not been run, or ran as a rejected-only batch | `select count(*) from entity_alias_confirmed;` |
| `Not saved. These names already belong to another group: ...` | a name you confirmed is already in a different group | move or untick it in the review page, export again |
| `verify_rollout.py --after` fails "missing" | the export was edited, or a name reduces to the same key as another in the same group | the check prints the names; compare with query 7 |

## What was tested and what was not
Tested: both migrations (apply, then apply again; data intact), permissions as the real `anon` and `authenticated` roles, the exported SQL (apply, repeat, three deliberate failures that each saved nothing), the rollback, and the verifier (14 of 14 on a correct set-up; each of four injected faults made it fail with a clear message). Pages in database mode against a stand-in API in front of that database: same numbers as local mode, local decisions ignored, and a clean fall back when the database is down, returns an error, or takes longer than 3 seconds.
Not tested: the real Supabase API (PostgREST) in front of the live project, since the migrations are not applied; the first `--after` run is that test. Advisor counts after the rollout are expected, not observed.
