# India Capital Tracker

A live feed of foreign money moving into and out of India: investments, exits,
offshore and GIFT City fund launches, and funds changing jurisdiction.

Built by [Kishan Singhania](https://www.linkedin.com/in/kishansinghania/).

## Layout

| Folder | What it is |
|---|---|
| `site/` | The public website. Cloudflare Pages publishes this folder on every push to `main`. |
| `supabase/functions/ingest/` | The collector that runs every 30 minutes: Google News searches and NSE bulk/block deal files. |
| `claude-dashboard/` | The private dashboard page. |

## Deploying

- **Website:** push to `main`; Cloudflare Pages deploys `site/` automatically (no build step).
- **Collector:** deployed to Supabase as the `ingest` edge function.
