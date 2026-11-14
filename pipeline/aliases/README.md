# Alias table: which names are the same investor or company

The same investor is written many ways across the tables: `SVF II MEERKAT (DE) LLC`, `SoftBank Vision Fund` and
`SoftBank` are one group; `FIDELITY FUNDS - INDIA FOCUS FUND` is a Fidelity fund. Without a mapping, the Investors
directory finds only 50 of 552 news names in the shareholding filings, and the profile pages cannot join anything.

## Pieces
| File | What it does |
|---|---|
| `build_company_candidates.py` | Same idea for companies, but anchored on NSE symbols and ISINs (see "Companies" below). Writes `candidates_company.json` (not committed) and `mockups/v2/company_alias.js` |
| `build_candidates.py` | Investors. Reads names from stories, shareholdings, fpi_registry and CCI orders and PROPOSES groups. Writes `candidates.json` (not committed, 1.4 MB) and optionally `mockups/v2/alias.js` for the review page |
| `aliases_curated.json` | Hand-written patterns, applied first. Only SoftBank is in it today |
| `../../supabase/migrations/20261114_entity_aliases.sql` | Stores the owner's DECISIONS only (`entity_group`, `entity_alias`, `entity_of()`). **Not yet applied to the live project** |
| `../../supabase/migrations/20261115_entity_companies.sql` | Run after the first one. Adds symbol and ISIN to company groups, makes aliases unique per kind, adds the `part_of` relation and `entity_of(name, kind)`. **Not yet applied** |
| `ROLLOUT.md` | The checklist for applying this to the live project: preflight results, steps, checks, rollback, troubleshooting |
| `verify_rollout.py` | Read-only checks from outside (`--before`, `--after`); never writes |
| `verify_after_apply.sql` | Read-only checks you run in the SQL editor: permissions, policies, security mode, counts |
| `../../supabase/rollback/20261115_entity_aliases_down.sql` | Removes everything the two migrations created, nothing else |
| `../../mockups/v2/alias.html` | Review queue for investors and companies: confirm, reject, untick members, change relations, export SQL |

## How a name gets proposed
1. **Exact**: equal after `norm_name()` (same function as the database, checked on 2,247 name pairs with no difference). Already merged; not reviewed.
2. **Curated pattern** from `aliases_curated.json`.
3. **Initials**: "ADIA" and "Abu Dhabi Investment Authority" (4 to 6 letters, both seen in news).
4. **Prefix**: the name starts, on a word boundary, with an investor written up in news ("GOLDMAN SACHS BANK EUROPE SE" starts with "Goldman Sachs"). Country names and generic words never count as a start.

Relations: `same`, `fund_of`, `vehicle_of`, `related`. Names with custodian or trustee wording ("Re:", "as trustee", "on behalf of") are flagged `held_via` and are OFF by default, because the fund usually belongs to someone else.

## Running it
```bash
python3 pipeline/aliases/build_candidates.py --ui mockups/v2/alias.js --top 150
python3 -m http.server -d mockups/v2     # then open alias.html
```
Review, then press "Download SQL for the database", read the file, and run it in the Supabase SQL editor.
Re-running the same file changes nothing.

## What the last run produced (snapshot 14-Nov-26)
- 15,588 distinct names; 143 proposed groups covering 2,116 names (Fidelity 412, BlackRock 179, HSBC 91, Goldman Sachs 84 ...).
- Relations proposed: fund_of 1,466 · related 409 · same 155 · held_via 75 · vehicle_of 11. Confidence: medium 1,676 · high 154 · low 286.
- If every proposal were right, news names also found in shareholding filings would go from 50 to 151 and in the FPI register from 66 to 194. **An upper bound.** Nothing is confirmed; the real gain is whatever survives review.

## What was checked
- Migration applied to a throwaway PostgreSQL 16 database (not the live project): anonymous users read only confirmed aliases and only groups that have one; a signed-in non-owner cannot write; the owner can; duplicates and bad values are refused; `entity_of()` resolves a spelling variant and ignores rejected aliases. This caught a real bug (an unqualified `id` in the group policy), now fixed.
- Review page to SQL to database, end to end: confirm, reject, rename, untick a member, change a relation; decisions survive a reload; the exported SQL runs and is idempotent.
- By hand, 70 random proposals were read. Three error patterns were found and fixed (country names as group names, custodian wording, a 3-letter acronym rule). Of 30 non-fund proposals read after the fixes, none was clearly wrong, but several rest on a brand meaning one owner ("Prudential", "Kia"), which is why every proposal needs the owner's decision. This is a spot check, not a measured precision.

## Not done
- Only the top 150 groups by impact are loaded in the review page; the full list is in `candidates.json`.
- Names are linked by text only. ISINs, LEIs and registration numbers are not used as evidence.
- The site does not read `entity_of()` yet; wiring it into the Investors directory, profiles and Registrations is the next step after the first decisions.
- The generator is not scheduled; it should run after each ingest once decisions exist, and skip names already decided.

## Companies (`build_company_candidates.py`)
A listed company has identifiers, so the rules are stricter than for investors.

| Level | Rule | Reviewed? |
|---|---|---|
| certain | same NSE symbol or ISIN in any table: the NSE shareholding feed (2,716 rows), corporate actions, deals, shareholdings, limits. A rights-entitlement symbol (`OLAELEC-RE`) joins its base symbol. Symbol and ISIN are joined with union-find, so an ISIN change after a share split stays one company | no |
| exact | a free-text name (news target, CCI party, ODI Indian party) equals ONE registered name after cleaning: address after a comma, "(India)", "Pvt", typos such as "LIMTED", and "IPO" are ignored. "Trust", "Fund" and "LP" are kept, because they make it another kind of body | no |
| proposed | the text is the start of ONE registered name ("Lenskart" for "Lenskart Solutions Limited"), or a registered name is the start of the text ("Tata Steel overseas arm") | **yes** |
| ambiguous | the text fits several registered names; listed in the review page, never proposed | needs a symbol or ISIN |

A text that is already a complete legal name ("Gulf Oil Corporation Ltd", "Hitachi, Ltd", "X LLP") is never linked to a longer registered name: it is a different company. A text that also appears as an investor in the news is flagged. Subsidiary-type links (`part_of`) are off by default.

Last run (snapshot 14-Nov-26): 2,530 listed companies; 11,882 free-text names checked (mostly ODI parties and unlisted targets, which have no symbol); 871 link exactly; 63 groups with 71 proposed names (28 "same" and 43 "part of"); 4 ambiguous (LTIMindtree was renamed, Jain Irrigation has equity and DVR shares, GACM has two entries, "Tamil Nadu operations" is generic). Of 1,154 news items that name a target, 513 already link to a listed company; accepting every proposal would make it 550. The rest name unlisted or foreign companies.

Checked: 40 random exact links read by hand, 39 correct; the wrong one ("Highway Infrastructure Trust" matched to a company because `norm_name()` drops "trust") exposed a rule and was fixed. All 28 "same" proposals read by hand: 26 look right; "Prudential" (a sugar company matched to the insurer's name) is wrong and is flagged, and "Bodhi Tree" is unclear. "Hitachi, Ltd" was dropped by the complete-legal-name rule. A first, looser version produced 214 proposals, most wrong; the stricter rules cut it to 71.

Not done for companies: unlisted companies (startups) are only grouped by exact cleaned name; there is no registry (CIN or LEI) for them. Issuers with several listed securities under different names (equity and DVR) are not merged. Subsidiaries are not rolled up to a parent.

## Export SQL: safety checks
`Download SQL` writes one file for both kinds. It collapses two spellings that reduce to the same `norm_name()` key into one alias, and it stops with "Not saved" (changing nothing) if the same name is in two groups, is both confirmed and rejected, or already belongs to a different group in the database. Tested on a throwaway PostgreSQL 16 with both migrations: a repeat run is a no-op, and each of the three failures was triggered on purpose and left the data unchanged.

## Using the aliases on the site (`mockups/v2/resolver.js`)
`window.ALIASES` is the browser twin of `entity_of(name, kind)`: `resolve(name, kind)` returns the confirmed group (name, relation, symbol, ISIN) or nothing, and `groupOf()` gives the key to group by. Its `norm()` is a copy of `norm_name()`; it was compared with PostgreSQL on 14,223 names (accents, CJK text, tabs, zero-width characters) with no difference.

Two sources, same lookup:
- **local** (default): every confirm, reject or untick in `alias.html` is published to this browser, and the other pages update at once (even in another open tab). It works before the migrations are applied, and only for the person who made the decisions.
- **database**: set `aliasSource: 'database'` in `mockups/v2/config.js`. The pages wait for the aliases before first paint, ignore local decisions, and fall back to them (with a visible note) if the database is down, errors or takes longer than 3 seconds. It pages through the view `entity_alias_confirmed` (added to migration 20261115; tested on PostgreSQL, anonymous users see only confirmed aliases and cannot write to it). Tested against a stand-in API in front of a real PostgreSQL, with every query run as the `anon` role: same numbers as local mode on all five pages, and a clean fall back when the database is down, returns HTTP 500 or is slow. **It has not been run against the live project**; the first run after applying the migrations is that test (see `ROLLOUT.md`).

Pages using it: the Investors directory (rows merge into confirmed groups; a "N names" tag lists them), Registrations ("in deals" tag), Deals (investor shown under its group name with an "alias" tag, search finds either name, and the count after "+" counts investors not legs), and the SoftBank and Meesho profiles (a link reads "Confirmed" once you confirm it, "Name match" before). Not wired: Regulations (the CCI-to-deal links are still computed from exact names), and the profile pages' underlying data, which is still a SoftBank snapshot.

### What confirming three groups did (Goldman Sachs, Fidelity, SoftBank Group; 510 aliases)
Each number was recomputed in Python from the saved decisions, without using any page code, and matched the page:
| Page | Before | After |
|---|---|---|
| Investors directory | 1,645 names | 1,599 investors |
| News names also found in filings | 50 of 552 | 69 of 552 |
| Goldman Sachs row | 10 bought / 3 sold (one name) | 26 / 7 (14 names) |
| Registered FPIs tagged "in deals" | 51 | 519 (Fidelity's funds are now recognised) |
| 13-Nov Meesho buyers (Deals) | SOCIETE GENERALE +9 (11 legs, 10 distinct names) | +7 (8 investors) |
| SoftBank profile | 8 names, "Name match" | 8 names, "Confirmed" |
Clearing the decisions returned every page to its original numbers.

"Investors in both news and filings" can go DOWN after merging (50 to 45 here) because two overlapping names become one investor; the coverage measure is "news names also found in filings".
