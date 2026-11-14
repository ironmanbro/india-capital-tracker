# The home pages: how they are built, refreshed and published

**Promoted on 14-Nov-26.** The new design is the main page at `/` (files directly in `site/`). The previous app moved, unchanged apart from its address, to `/classic/` (`site/classic/index.html`) and still has sign-in, Network, owner tools, weekly brief and the GIFT/ODI desks. Old `/v2/...` links redirect to `/...` (`site/_redirects`). Every page has a "Classic site" link to `/classic/`.

## What is in it
| | |
|---|---|
| Pages | Home (`/v2/`, with Today and Markets), Deals, Investors directory, Registrations, Regulations. Source of truth: `mockups/v2/*.html`, copied by `package_site.py` |
| Data | `data.js`, `deals.js`, `inv.js`, `reg.js`, `regs.js`, built from the project's public tables by `build_*.py`. Static files: the pages read nothing from the database in the browser |
| Not shipped | the alias review page and its data (owner-only tools), the SoftBank and Meesho profile mock-ups, screenshots, the README. `package_site.py` copies only the files it manages (`package_site.py --list`) |
| Public config | `site/config.js`, written by `package_site.py`. It lists the pages that exist, so links to unbuilt pages and the placeholder search box are hidden; alias grouping is off (`aliasSource: 'local'`) until aliases are loaded (see `pipeline/aliases/ROLLOUT.md`) |

Pages are indexable (the `noindex` line is stripped on packaging). `/classic/` has its own canonical address.

## How it stays current
`.github/workflows/refresh_v2.yml` runs after each run of "Sync NSE and NSDL data" (and daily at 10:00 IST as a fallback, and on demand):
1. `package_site.py` runs `build_all.py`, which fetches everything and checks it. **If any fetch or check fails, nothing is written** and the job fails, so the site keeps its last good data. Checks include: daily NSDL flows no more than 10 days old, at least 10,000 register rows, at least 100 rules and CCI orders, at least 50 deals in 90 days, and the exchange deals of the latest day.
2. `keep_if_changed.py` restores the committed files if only the build stamp differs, so a quiet day makes no commit.
3. Otherwise the job commits `site/v2` to `main`, and Cloudflare publishes it like any other change to `site/`.

All date windows ("last 90 days", "month to date", the previous month, the sector fortnights, days left on a registration) are computed from the data or from today's date in India, never fixed to a date. Tested by shifting the data a month forward and by faking today's date.

## Run and test it yourself
```bash
python3 pipeline/site_v2/package_site.py            # builds the home pages into site/ (about 40 seconds; reads public tables, needs no secret)
npx wrangler dev --port 8790 --local                # serves site/ with your real _headers and asset rules
node pipeline/site_v2/tests/pages.js /tmp           # every page, desktop and phone: errors, security-policy violations, "NaN", overflow, dead links
node pipeline/site_v2/tests/behaviour.js            # service worker, old site, offline, month labels, today's date
```
The tests need Playwright (`npm i playwright`). They were last run on 14-Nov-26: 12 of 12 page loads and all behaviour checks passed.

## The service worker
`site/sw.js` ignores the new pages. Without that, the old app's offline cache would have served stale `/v2` data on the first view, and an offline visit to `/` could have opened a `/v2` page. Tested: a changed data file shows on the very next load, and offline `/` still opens the old app.

## Service worker and sign-in after the move
- `site/sw.js` now serves only `/classic/` offline (cache `ict-v2`); the home pages always come from the network, so their data is never stale.
- Sign-in links (email, Google, etc.) still return to the site root, the address Supabase already allows. A small script at the top of `mockups/v2/ui.js` forwards those returns (`#access_token=`, `#error_description=`, `#firm/`, old `?story=`, `?tab=` links) to `/classic/` with the query and hash intact.

## Rolling back the promotion
Revert the promotion commit: `/` returns to the previous app, `/classic/` and the redirects disappear. No data is touched.

## Differences from the mock-ups, found while making them real
- "Largest FAR holdings" on the mock-up Home page was **wrong**: a fetch cut off at 100 rows missed the biggest positions (07.38 GS 2027, 07.18 GS 2033). The builder reads all of them.
- The mock-up "Reported deals" table included exchange trades labelled as news. The builder keeps news only.
- "Nov MTD", "All 29", the sector fortnight headings, "since 15-Aug", "Registered in 2026", and today's date were hard-coded. All are data-driven now.
- Holidays: the builder reads the next 60 instead of the next 8, so the Calendar is complete.

## Known limits
- The Investors directory lists names as written; grouping (Fidelity funds, Goldman Sachs entities) switches on after aliases are confirmed and loaded.
- No sign-in, no visit counting, no alerts, no Network view, no weekly brief, no GIFT City desk. Those are still in the old site.
- `reg.js` (the whole FPI register, so search works in the browser) is about 1.3 MB; Cloudflare compresses it in transit. A server-side search would be lighter on slow phones.
- The pages show exchange bulk and block deals and provisional FII/DII figures from NSE. The old site already shows the same data, but `.gitignore` notes that NSE's terms for storing and redistributing it were never reviewed. Only the latest day's top 10 deals and ten days of FII/DII are included.
- The tax table on the Regulations page comes from Deloitte (a secondary source), as on the old site.
