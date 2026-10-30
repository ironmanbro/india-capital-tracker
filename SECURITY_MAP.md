# Security map: CapitalColumbus

Written during the pre-launch security pass (toolkit checks 00 and 26). No secret values are recorded here.

## What the app is
A static website (`site/`, served by Cloudflare Workers) that reads public data from Supabase with a read-only publishable key. No visitor accounts, no passwords, no payments, no cookies, no file uploads to a server.

## Entry points
| Entry point | Who can call it | Protection |
|---|---|---|
| `site/index.html` and `site/vendor/lenis.min.js` | Anyone | Static files; security headers in `site/_headers` (HSTS, CSP, frame-ancestors none, nosniff, referrer policy, permissions policy) |
| Supabase REST (`/rest/v1/...`) | Anyone with the publishable key | RLS on every table; the public role has SELECT only, on views and tables meant to be public; `events` (unreviewed stories) is not readable; `app_secrets`, `site_visits`, `shp_filings`, `backfill_weeks`, `directory_state` have no public policy |
| RPC `record_visit` | Anyone | Cap of 120 new rows a minute, visitor id trimmed to 64 characters |
| Edge function `holdings` | Owner (key in request body) | Key hash in `app_secrets`; row validation; generic error text |
| Edge function `leads` | Owner (key in request body) | Same; POST only |
| Edge functions `ingest`, `shp`, `profiles`, `private` | Scheduled jobs (database cron) | `x-ingest-key` header |
| Cron jobs (pg_cron) | Database only | Read the ingest key inside SQL; nothing is displayed |

## Data stored
Public market data (news, NSDL/IFSCA/NSE filings, FPI flows), investor facts from public registers, and anonymous visit counts (random browser id, no personal data). The IFSCA directory contact details shown in the Directory tab are IFSCA's own published data.

## Trust boundaries
- Browser controls only what it displays; every write goes through an owner-key function or a database job.
- Text from the web (news, Wikidata, investor websites) is stored as data and escaped on display; web addresses are shown only if they start with http(s).
- The daily review (an AI reviewer) reads news headlines as data, never as instructions.

## Third parties
Supabase (database, edge functions), Cloudflare (hosting), Google News RSS, NSE/NSDL/IFSCA/DPIIT public files, Wikidata/Wikipedia, investors' own websites (home page only, robots.txt respected), Lenis (vendored, MIT).
