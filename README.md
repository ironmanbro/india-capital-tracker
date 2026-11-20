# Indian Capital Tracker

A live feed of foreign money moving into and out of India: investments, exits,
offshore and GIFT City fund launches, and funds changing jurisdiction.

Built by [Kishan Singhania](https://www.linkedin.com/in/kishansinghania/).

## Layout

| Folder | What it is |
|---|---|
| `site/` | The public website. Cloudflare publishes this folder on every push to `main` (see `wrangler.jsonc`). |
| `supabase/functions/ingest/` | The collector that runs every hour: Google News searches and NSE bulk/block deal files. |
| `claude-dashboard/` | The private dashboard page. |
| `supabase/baseline/` | Reference snapshot of the live database schema (tables, views, functions, policies, cron jobs), checked by `verify.sh`. |
| `pipeline/ops/` | `check_freshness.py`: read-only check that every dataset and collector is recent (run every 6 hours by `.github/workflows/freshness.yml`). |
| `docs/` | Milestone notes and the source-licensing decision log. |

## Deploying

- **Website:** push to `main`; Cloudflare deploys `site/` automatically (no build step). `wrangler.jsonc` limits what is published to that folder.
- **Collector:** deployed to Supabase as the `ingest` edge function.

## Checks that run automatically
- **CI** (`.github/workflows/ci.yml`, every push): Python tests, schema baseline build in an empty Postgres, workflow YAML and secret-pattern scan.
- **Data freshness** (`freshness.yml`, every 6 hours): fails (and GitHub emails the owner) if a dataset or collector is older than its allowed age.
- **Data sync** (`cron_sync.yml`): now fails the run if a collector fails unexpectedly (BSE's known 403 is listed as accepted).
