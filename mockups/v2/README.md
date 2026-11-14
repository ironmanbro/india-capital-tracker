# ICT v2 mockups (week 1)

Static, data-driven mockups of the Monitor and Flows desks. Not wired to production.

Open: `python3 -m http.server` in this folder, then `monitor.html` or `flows.html`.

| File | Role |
|---|---|
| `tokens.css` | Design tokens (light primary, dark option) and base components: panel grid, table, meter, segmented control |
| `ui.js` | The only number/date formatter, shared header and ticker, SVG bar/line charts, heat table |
| `data.js` | Snapshot of live Supabase tables (read-only, public key), built 2026-11-14. Generated, do not edit |
| `profiles.js` | Snapshot for the two profile pages (Meesho, SoftBank Group). Generated, do not edit |
| `monitor.html`, `flows.html` | Home: Today and Markets |
| `deals.js` | Snapshot for the Deals page (309 deals since 15-Aug-26, ODI series). Generated, do not edit |
| `deals.html` | Deals landing view: filters, grouped table, weekly chart, ODI |
| `inv.js` | Snapshot for the Investors directory (1,646 names from stories and shareholding filings). Generated, do not edit |
| `investors.html` | Investors directory: filters, sortable table, country and activity panels, coverage audit |
| `company.html` | Company profile: Meesho Ltd |
| `investor.html` | Investor-group profile: SoftBank Group |
| `screens/` | Screenshots of the current state |

## Rules the mockups follow
- 2px radius, no shadows, gradients or blur; 1px hairlines between panels; one accent colour.
- Type scale 11/12/13/15/18/24; every number in IBM Plex Mono with tabular figures, right-aligned.
- Units live in the panel or column header (₹ cr, US$ mn, %), never in the cell. ₹ uses Indian grouping, US$ uses Western.
- Dates are `13-Nov-26`. Negative numbers use a true minus sign. A value that rounds to zero shows `0`, uncoloured.
- Every panel names its source in the footer. Grade tags: `A` regulator/exchange data, `C` news-derived. Grade C rows are never added into any total.

## Navigation (5 tabs)
Home (Today, Markets, Weekly brief), Deals, Investors (Directory, Ownership changes, Network, Countries, 13F, plus profile pages), Registrations, Regulations.
Only Home, Deals, the Investors directory and the two profiles are drawn; every other link is a placeholder.

## What the profile pages showed about name matching
- Meesho exchange deals name 50 distinct clients; 16 (32%) match the NSDL FPI register exactly (registration number shown). 1 group (SVF) links by name pattern; 33 are unlinked. No fuzzy matching was tried.
- SoftBank appears under 8 different names (six SVF vehicles plus "SoftBank" and "SoftBank Vision Fund"). None is in the FPI register, so only the name can link them. Every such link is tagged "Name match" (unconfirmed).
- The same holder is spelled differently between filings (e.g. "Svf Ii Ostrich (De) Llc" vs "SVF II OSTRICH (DE) LLC"), so names are normalised before the latest filing per holder is chosen.
- News that merely mentions SoftBank is not counted as a SoftBank deal.

## Checks done on the data
- NSDL daily: the segment rows add up to the Total on all 29 days (largest gap 0).
- NSDL daily October sum (−24,475 ₹ cr) equals the monthly table for October.
- CYTD −1,37,699 ₹ cr is about −US$14.6 bn at current rates, matching the figure the live site shows.

## Known gaps
- Fonts load from Google Fonts here; self-host them in production.
- Daily NSDL history in the table starts 1 Oct 2026, so segment-level FYTD is not shown (only the total, from the monthly table).
- FBIL USD/INR runs about a week behind (last point 06-Nov-26).
- Desks other than Monitor and Flows are placeholders in the nav.
- Phone layout: tables scroll sideways inside their panel; the first column is not yet pinned.

## Deals landing view
- One table for exchange deals (A, NSE bulk/block of ₹25 cr+) and reported deals (C, news). A and C values are shown side by side and never added.
- Filters: period, type (into India / exit / fund launch / abroad), source, stage, size, text search. Filter state lives in the URL hash, so a view can be shared.
- Exchange deals are grouped by stock and day by default (one block trade had 16 client rows); "Every client" shows the raw legs.
- Exchange match: a reported deal gets a tag when an exchange deal has the same direction, the same first word of the target, and a date within 2 days. 4 of 249 reported deals match today; this is a name match and unconfirmed.
- Not built: Exchange, Reported, Outbound and Fund-launch sub-views (links are placeholders); private funding rounds are not a separate view because the data has no flag for them (use the investor-type breakdown).
- ODI figures are labelled US$ mn, as RBI's workbook reports; not independently re-checked here.

## Investors directory
- One list of 1,646 names: 551 from news and exchange deals, 1,142 filed holders in shareholding patterns. Names are cleaned (case, punctuation, legal suffixes such as Ltd/LLC/Pte) and then merged.
- Only 47 names appear in both news and filings after cleaning (9% of news names), and home country is known for 26%, type for 55%. The page states these figures instead of hiding them.
- Filters (view, 12-month activity, type, home country, name) and sort order are kept in the URL hash. Counts: Bought = entries into India, Sold = exits, over the last 12 months.
- SoftBank is the only group merged by name pattern (8 names, "SVF…" and "SoftBank…"), tagged unconfirmed. Other duplicates remain, for example two spellings of Goldman Sachs Bank Europe SE, and index-fund families are listed fund by fund.
- Home country comes from news items or Wikidata profiles; filed holders have no country field, so most show "–".
- Not built: profile pages for anyone except SoftBank Group, Ownership changes, Network, Countries, 13F.
