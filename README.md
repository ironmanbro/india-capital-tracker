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

## Deploying

- **Website:** push to `main`; Cloudflare deploys `site/` automatically (no build step). `wrangler.jsonc` limits what is published to that folder.
- **Collector:** deployed to Supabase as the `ingest` edge function.

## License

MIT. See [LICENSE](LICENSE).
