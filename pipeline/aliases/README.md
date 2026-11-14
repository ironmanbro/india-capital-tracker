# Alias table: which names are the same investor

The same investor is written many ways across the tables: `SVF II MEERKAT (DE) LLC`, `SoftBank Vision Fund` and
`SoftBank` are one group; `FIDELITY FUNDS - INDIA FOCUS FUND` is a Fidelity fund. Without a mapping, the Investors
directory finds only 50 of 552 news names in the shareholding filings, and the profile pages cannot join anything.

## Pieces
| File | What it does |
|---|---|
| `build_candidates.py` | Reads names from stories, shareholdings, fpi_registry and CCI orders and PROPOSES groups. Writes `candidates.json` (not committed, 1.4 MB) and optionally `mockups/v2/alias.js` for the review page |
| `aliases_curated.json` | Hand-written patterns, applied first. Only SoftBank is in it today |
| `../../supabase/migrations/20261114_entity_aliases.sql` | Stores the owner's DECISIONS only (`entity_group`, `entity_alias`, `entity_of()`). **Not yet applied to the live project** |
| `../../mockups/v2/alias.html` | Review queue: confirm, reject, untick members, change relations, export SQL |

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
- Companies (kind `company`: Meesho Ltd vs Meesho Limited vs the NSE symbol) have no generator yet.
- Only the top 150 groups by impact are loaded in the review page; the full list is in `candidates.json`.
- Names are linked by text only. ISINs, LEIs and registration numbers are not used as evidence.
- The site does not read `entity_of()` yet; wiring it into the Investors directory, profiles and Registrations is the next step after the first decisions.
- The generator is not scheduled; it should run after each ingest once decisions exist, and skip names already decided.
