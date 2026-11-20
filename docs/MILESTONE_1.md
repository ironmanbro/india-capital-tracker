# Milestone 1: Foundations (status 2026-11-20)

Branch `milestone-1-foundations`. Repo-only changes; **nothing was applied to production** (no database change, no function deploy, no Cloudflare change).

## Done in the repo
| Item (audit ref) | What | Verified how |
|---|---|---|
| Schema baseline (C2) | `supabase/baseline/`: 36 tables, 11 views, 24 functions, 42 policies, 69 indexes, 2 triggers, 21 cron jobs captured from production | Built in an empty Postgres 16; counts match production exactly (`verify.sh`). The build caught one capture error (generated column) which is fixed |
| CI (H7) | `ci.yml`: 29 Python tests (24 existing + 5 new), baseline build in Postgres 17, YAML + secret-pattern scan | Ran green on GitHub (branch push, commit d6a87f6): python-tests, schema-baseline (Postgres 17), hygiene |
| Freshness monitor (C5) | `pipeline/ops/check_freshness.py` + `freshness.yml`: 14 dataset checks + 18 collector checks, with documented limits; parses mixed `as_of` formats. Scheduled runs start only after merge to `main` | Run against production read-only: 32 checks, 0 failing, 1 warning (Wikidata profiles, known) |
| Hidden failures (C5) | `cron_sync.yml` no longer swallows collector failures (`|| echo`); `run_all.py` accepts a named list of known failures (BSE 403) | Logic reviewed; YAML parsed. Takes effect only after this branch is merged to `main` (scheduled workflows run from the default branch) |
| Key comparison (H5) | 17 collector functions use a constant-time key check (helper inlined per file so single-file deploys keep working) | Helper unit-checked in Node; all 22 TS files strip-parse without syntax errors; not run in Deno |
| Docs (TD-11) | `SECURITY_MAP.md` rewritten to match reality; `docs/licensing/SOURCE_DECISIONS.md` decision log (all PENDING) | |

## Corrections to the Milestone 0 report
- **FX staleness is source lag, not a silent failure.** FBIL's public feed runs about a week behind (stated in `supabase/functions/fx/index.ts`). `fx_ref` ending 13 Nov on 20 Nov is expected; the monitor allows 12 days.
- **Wikidata profile staleness is "never scheduled".** The `profiles` edge function has no cron job; the GitHub enrichment step works (it processes 64 investors with a Wikidata id). I had wrongly blamed `continue-on-error`.
- **Counts:** 36 tables (not 34); 22 live edge functions (not 20), 21 with `verify_jwt` off (not 19 of 20).
- **`runs.items_new` is not "new rows"**: e.g. `fbil_fx` reports `items_new = items_found` (621 each day) because it counts rows upserted. Treat `items_new` as unreliable until fixed.
- **`cron_sync` was green only because failures were hidden**: `bse_deals.py` fails every run with HTTP 403 (BSE blocks GitHub). This is now an explicit accepted failure.

## Not done, needs your decision or approval (production-affecting)
| # | Action | Why not done | Priority |
|---|---|---|---|
| 1 | **Deploy** the 17 updated edge functions to Supabase | Outward-facing; also the repo copy may differ from the live copy (not diffed yet). I can diff live vs repo (read-only) first, then deploy on your go-ahead | High |
| 2 | **Create a staging Supabase project** and apply the baseline | Creates a billable project; you did not answer this question in the audit. Needed to prove the baseline end to end and to test changes safely | Critical |
| 3 | Enable **leaked-password protection** in Supabase Auth | Changes production auth settings | Medium |
| 4 | Cron decisions: re-enable `odi-monthly`; add a schedule for `profiles`; add `github_dispatch_token` or drop the three inert `github-backup-*` jobs | Production changes with data and cost effects | High |
| 5 | Remove or lock down `public._probe`, `desk-probe`, `probe`, `set_event_status`/`edit_key` (no caller found) | Needs your confirmation they are unused | Medium |
| 6 | Licensing decisions (`docs/licensing/SOURCE_DECISIONS.md`) | Yours to make (with counsel if needed) | Critical |
| 7 | Fix `runs.items_new` semantics and the `feed_records.as_of` text dates / 1970 placeholder row | Data change to production tables | High |
| 8 | Remove personal email from the SEC User-Agent in `cron_sync.yml` | Need a replacement contact address from you | Low |
| 9 | Repo clean-up (`.claude/skills`, `.agents`, `mockups/` PNGs out of the production repo) | Opinionated and large; propose before doing | Low |

## How to verify locally
```bash
python3 -m pytest pipeline/tests -q                       # 29 tests
python3 pipeline/ops/check_freshness.py                   # read-only, uses the public key
PGHOST=localhost PGUSER=postgres supabase/baseline/verify.sh   # needs a local Postgres
```
