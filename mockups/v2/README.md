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
| `reg.js` | Snapshot for Registrations: full NSDL register (12,364 FPIs), watch lists, IFSCA counts, limit lists. About 1.3 MB because the whole register is embedded so search works offline; production would query the database. Generated, do not edit |
| `registrations.html` | Registrations tab: watch lists and full register, filters, CSV, analytics and limit panels |
| `regs.js` | Snapshot for Regulations: 162 SEBI/RBI rules since 2021, 60 latest CCI orders. Generated, do not edit |
| `regulations.html` | Regulations tab: rules and circulars, compliance calendar, CCI approvals, reference |
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
All five tabs are drawn at landing level (Home, Deals, Investors directory, Registrations, Regulations), plus two profile pages; every other link is a placeholder.

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

## Registrations
- Six lists share one table: expiring within 90 days (621), late-fee window (43), new in 30 days (73), dropped off the register (25), invalid (41), full register (12,364). The counts equal those of the live site's `fpi_watch` function.
- Filters (list, category, country, name or registration number) and sort order are kept in the URL; "Download CSV" exports the current rows.
- Side panels: new registrations per month (dates exist for 3,352 FPIs, 2023 onward), where FPIs are based, category and type, companies nearing the foreign limit, GIFT City (IFSCA) licence types.
- Link to deals: 52 of 12,364 registered names match an investor with deals in the last 12 months after name cleaning; they show a bought/sold tag that opens the Investors directory. Name match, unconfirmed (for example "UBS AG" matches the investor "UBS").
- "Registered in 2026" (853) is NSDL's own count; the 30-day watch list (73) uses a different date field than the directory's own 30-day figure (68), so only the watch-list figure is shown.
- Not built: Foreign investment limits, GIFT City and Analytics sub-views (links are placeholders; their summaries are panels on this page); weekly brief.

## Regulations
- 162 SEBI and RBI rules (105 SEBI, 57 RBI) with issue date, document type, the instruments they affect (FPI 89, FDI 19, FVCI 12, ODI 11, GIFT City 5) and a link to the regulator's own document. Filters: period, regulator, document type, "affects", text; all kept in the URL.
- Summaries and "affects" labels are written automatically and not reviewed (classifier status "review" on every row), and the page says so; the linked document is the authority.
- Only 15 of 162 rules carry a stated effective date, so the compliance calendar is short by design; it shows only those.
- CCI approvals link to reported deals only on an exact normalised name match (whole-word boundary) with a plausible date gap; exchange deals are excluded because block trades need no CCI approval. 10 of 132 orders in the last 12 months match. A first, looser word-match rule gave 101 false links and was dropped.
- Reference: debt-limit utilisation (CCIL/NSDL) and the withholding-tax table, which comes from Deloitte's India Highlights (August 2026), a secondary source and not the Income-tax Act; marked grade B and flagged on the page.
- Not built: DPIIT, IFSCA and PIB documents are collected but not yet classified as rules; the sub-views (calendar, CCI, reference) are placeholders; FEMA/FDI sectoral caps are not in the data yet.
