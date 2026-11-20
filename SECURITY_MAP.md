# Security map: Indian Capital Tracker

Rewritten 2026-11-20 (Milestone 1) after the Milestone 0 audit found the earlier version out of date (it said there were no visitor accounts).
No secret values are recorded here. Findings are "verified" only where checked against the live project on that date.

## What the app is
A static website (`site/`, Cloudflare Workers Static Assets) that reads public data from Supabase with a read-only publishable key,
plus **signed-in accounts** (Supabase Auth: email/password and social login; 9 users, 2 admins on 2026-11-20) used for notes, "following",
the daily email and per-user activity logging. No payments, no file uploads to a server.

## Entry points
| Entry point | Who can call it | Protection |
|---|---|---|
| `site/**` static files | Anyone | Headers in `site/_headers` (HSTS, CSP with `unsafe-inline` scripts, frame-ancestors none, nosniff, referrer, permissions policy) |
| `/sb/rest/v1/*` (Worker `worker.js`) | Anyone | Only anonymous GETs and 4 whitelisted RPCs are cached; anything with a token is forwarded uncached |
| Supabase REST (`/rest/v1/...`) | Anyone with the publishable key | RLS on all 36 tables; `anon` has SELECT only, and no grant on `events`, `app_secrets`, `app_admins`, `site_visits`, `shp_filings`, `investor_notes`, `user_activity` |
| Views `stories`, `directory_stats` | Anyone | SECURITY DEFINER **on purpose**: `stories` is the only public window onto reviewed `events`. The `events_read` policy is `USING (true)` and is inert only because `anon` has no table grant: do not grant SELECT on `events` |
| Public RPCs `home_summary`, `data_coverage`, `fpi_watch`, `country_brief`, `record_visit` | Anyone | SECURITY DEFINER with fixed `search_path`; `record_visit` caps 120 new rows a minute |
| RPCs `activity_summary`, `activity_timeline`, `activity_users` | Signed-in users | Each starts with `is_admin()` and raises otherwise (verified in source); they are still callable by every signed-in user, so that check is the only guard |
| RPC `set_event_status` | Not exposed to anon/authenticated (not in the advisor's lists) | Needs legacy `edit_key`; no caller found in the code. Candidate for removal |
| Edge functions `holdings`, `leads` | Owner key in the request body | SHA-256 of the key compared with `app_secrets.owner_key_hash`; CORS `*`; **no rate limit; one shared key** |
| Edge function `bse-ingest` | The owner's computer | `x-push-key` compared in constant time; strict row validation; writes only BSE deal rows |
| 17 collector functions (`ingest`, `flows`, `regs`, ...) | Database cron | Header `x-ingest-key` = `app_secrets.ingest_key` (**one shared key**, stored in plain text in the table). Comparison is now constant-time **in the repo**; deploy pending (see `docs/MILESTONE_1.md`) |
| `verify_jwt` | | `false` on 21 of the 22 live functions (only the unused `probe` verifies JWTs) |
| GitHub Actions | GitHub | Secrets `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (collectors, enrichment); `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `DIGEST_FROM` (digest; naming inconsistent with the first) |

## Data stored
Public market and regulatory data; investor facts from public sources; anonymous visit counts (`site_visits`: random browser id);
signed-in users' activity (`user_activity`: page/kind/short detail/device, purged after 12 months) and private investor notes (`investor_notes`, owner-only RLS);
IFSCA directory contact details as IFSCA publishes them (`ifsca_contacts`).

## Known weaknesses (open)
1. One shared `ingest_key` for every collector; plain-text in `app_secrets`. Rotation is a single UPDATE of the table row (jobs read it at run time), but a leak lets anyone trigger ingestion and LLM spend.
2. One shared owner key (no per-admin identity, no lockout, no audit log).
3. CSP allows `unsafe-inline` scripts (needed by the single-file v1 app).
4. Supabase Auth: leaked-password protection is **off**.
5. Advisor warnings: `public._probe` has a mutable `search_path`; extensions `pg_net`, `vector`, `pg_trgm` live in `public`; 5 + 8 SECURITY DEFINER functions are executable by `anon` / signed-in users.
6. No audit log; backups/PITR not documented (Supabase defaults assumed, not verified).
7. A personal email address appears in the `User-Agent` of `cron_sync.yml` (SEC EDGAR requires a contact).
8. `github-backup-*` cron jobs are inert (the `github_dispatch_token` secret does not exist).

## Trust boundaries
- Browser controls only what it displays; every write goes through an owner-key function, a signed-in RLS policy, or a database job.
- Text from the web (news, Wikidata, investor websites) is stored as data and escaped on display; web addresses are shown only if they start with http(s).
- The AI reviewer reads headlines as data, never as instructions.

## Third parties
Supabase, Cloudflare, GitHub (Actions), Resend (digest, inactive until secrets exist), Anthropic API (headline review), Google News RSS,
NSE/BSE/NSDL/IFSCA/DPIIT/SEBI/RBI/CCI/CCIL/FBIL public pages and files, Wikidata/Wikipedia, investors' own websites, SEC EDGAR, Lenis (vendored, MIT).
Source licensing status: `docs/licensing/SOURCE_DECISIONS.md`.
