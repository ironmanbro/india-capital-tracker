# The /v2 pages: how they are built, refreshed and published

`site/v2/` is the public copy of the new design (Home, Deals, Investors, Registrations, Regulations). The old site at `/` is unchanged and stays the main page. Every `/v2` page has a "Classic site" link back to it.

## What is in it
| | |
|---|---|
| Pages | Home (`/v2/`, with Today and Markets), Deals, Investors directory, Registrations, Regulations. Source of truth: `mockups/v2/*.html`, copied by `package_site.py` |
| Data | `data.js`, `deals.js`, `inv.js`, `reg.js`, `regs.js`, built from the project's public tables by `build_*.py`. Static files: the pages read nothing from the database in the browser |
| Not shipped | the alias review page and its data (owner-only tools), the SoftBank and Meesho profile mock-ups, screenshots, the README. `package_site.py` removes any stray file from `site/v2` |
| Public config | `site/v2/config.js`, written by `package_site.py`. It lists the pages that exist, so links to unbuilt pages and the placeholder search box are hidden; alias grouping is off (`aliasSource: 'local'`) until aliases are loaded (see `pipeline/aliases/ROLLOUT.md`) |

Pages carry `noindex` so search engines do not list `/v2` next to the main page. Remove that line from the six pages when the new design is promoted.

## Cap Radar and Watchlist (added 19-Nov-26)
| | |
|---|---|
| Cap Radar `limits.html` | NSDL red-flag and breach lists with room left, plus what changed between reports. `build_limits.py` writes `limits.js` and **appends each report to the history inside the committed file** (NSDL keeps only its latest report), so history starts on the first build and grows; it is never invented |
| Watchlist `watchlist.html`, `watch.js` | Follow companies, investors, countries, topics. Kept in the browser only; "new" means not seen since the follow was baselined; export and import as a file; a count beside Watchlist in the nav |
| Alerts when away | `push-sw.js`, `supabase/functions/push-subscribe`, `pipeline/alerts/`. **Off until switched on**: see `pipeline/alerts/README.md` |
Extra tests: `node pipeline/site_v2/tests/parity.js` (browser and alert sender find identical items), `python3 pipeline/alerts/tests/test_send_push.py`.

## How it stays current
`.github/workflows/refresh_v2.yml` runs after each run of "Sync NSE and NSDL data" (and daily at 10:00 IST as a fallback, and on demand):
1. `package_site.py` runs `build_all.py`, which fetches everything and checks it. **If any fetch or check fails, nothing is written** and the job fails, so the site keeps its last good data. Checks include: daily NSDL flows no more than 10 days old, at least 10,000 register rows, at least 100 rules and CCI orders, at least 50 deals in 90 days, and the exchange deals of the latest day.
2. `keep_if_changed.py` restores the committed files if only the build stamp differs, so a quiet day makes no commit.
3. Otherwise the job commits `site/v2` to `main`, and Cloudflare publishes it like any other change to `site/`.

All date windows ("last 90 days", "month to date", the previous month, the sector fortnights, days left on a registration) are computed from the data or from today's date in India, never fixed to a date. Tested by shifting the data a month forward and by faking today's date.

## Run and test it yourself
```bash
python3 pipeline/site_v2/package_site.py            # builds site/v2 (about 40 seconds; reads public tables, needs no secret)
npx wrangler dev --port 8790 --local                # serves site/ with your real _headers and asset rules
node pipeline/site_v2/tests/pages.js /tmp           # every page, desktop and phone: errors, security-policy violations, "NaN", overflow, dead links
node pipeline/site_v2/tests/behaviour.js            # service worker, old site, offline, month labels, today's date
```
The tests need Playwright (`npm i playwright`). They were last run on 14-Nov-26: 12 of 12 page loads and all behaviour checks passed.

## The service worker
`site/sw.js` now ignores `/v2/`. Without that, the old app's offline cache would have served stale `/v2` data on the first view, and an offline visit to `/` could have opened a `/v2` page. Tested: a changed data file shows on the very next load, and offline `/` still opens the old app.

## Publishing (needs your go-ahead: it makes the new pages public)
1. Merge the branch into `main`. Cloudflare publishes `site/`, so `/v2` goes live and `sw.js` updates.
2. Run the "Refresh the /v2 pages" workflow once by hand (Actions tab, Run workflow) to bring the data up to date. If it fails with a 403 on push, enable Settings, Actions, General, "Read and write permissions", or allow the bot on a protected `main`.
3. Open `/v2/` on a phone and a laptop. Check the line under the page title shows today's data date.

## Rolling back
- Pages only: delete the `site/v2` folder in a commit (and the refresh workflow, or it will rebuild them). The old site is not touched.
- Everything: revert the merge commit. The only change to the old site's files is three lines in `site/sw.js`.

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
