# Schema baseline (captured from production, 2026-11-20)

This folder is a **reference snapshot** of the live Supabase project (`urpphqybqmxlwhjghsmf`, Postgres 17), reconstructed
from catalog queries (`pg_get_viewdef`, `pg_get_functiondef`, `pg_get_constraintdef`, `pg_policies`, `cron.job`).
Until now the repo held only the later migrations; the core tables, views and functions existed only in the live database.

**Nothing here has been applied anywhere.** It is for reading, diffing and bootstrapping a staging project.

| File | Contents |
|---|---|
| `01_tables.sql` | 36 tables, constraints, identity columns, foreign keys, indexes |
| `02_views_functions.sql` | 11 views, 24 functions, 2 triggers |
| `03_rls_policies.sql` | RLS enablement and every policy |
| `04_cron_jobs.sql` | 21 `pg_cron` jobs (active flags noted). Secrets are read inside SQL from `app_secrets`; no literal secrets |

## Known limits (verify before relying on it)
- Generated DDL, not a `pg_dump`. Column order, sequences' start values, grants and ownership are not captured. Grants:
  Supabase defaults apply; the M0 audit found `anon` has SELECT only (and none on `events`, `app_secrets`, `app_admins`,
  `site_visits`, `shp_filings`, `investor_notes`, `user_activity`).
- Extensions needed: `pg_cron`, `pg_net`, `pgcrypto`, `uuid-ossp`, `pg_trgm`, `vector`, `supabase_vault`, `pg_stat_statements`.
- `fpi_registry.registered_on` is a STORED GENERATED column (the only one). Identity columns (all `GENERATED ALWAYS`): `events.id`, `runs.id`, `shareholdings.id`, `entity_group.id`, `entity_alias.id`, `user_activity.id`.
- `app_secrets` rows are **not** captured (values are secret). Required names: `ingest_key`, `owner_key_hash`, `bse_push_key`, `edit_key` (legacy), optional `github_dispatch_token`.
- The pre-existing files in `../migrations/` are kept as history. Several (e.g. `nse_*` tables) were created and later dropped.
- Next step (needs a staging project): apply `01`..`03` to an empty database and diff against production with `supabase db diff`
  or `pg_dump --schema-only`, then promote this folder to numbered migrations.

## Verified (2026-11-20)
`verify.sh` builds `stubs.sql` + `01`..`04` into an empty Postgres and checks object counts. The result matched production exactly:
36 tables, 11 views, 24 functions, 42 policies, 69 indexes, 2 triggers. Building it also caught one error in the first capture
(a stored generated column had been read as a default), so keep running the script after any edit.
