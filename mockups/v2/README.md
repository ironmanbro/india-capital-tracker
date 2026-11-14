# ICT v2 mockups (week 1)

Static, data-driven mockups of the Monitor and Flows desks. Not wired to production.

Open: `python3 -m http.server` in this folder, then `monitor.html` or `flows.html`.

| File | Role |
|---|---|
| `tokens.css` | Design tokens (light primary, dark option) and base components: panel grid, table, meter, segmented control |
| `ui.js` | The only number/date formatter, shared header and ticker, SVG bar/line charts, heat table |
| `data.js` | Snapshot of live Supabase tables (read-only, public key), built 2026-11-14. Generated, do not edit |
| `monitor.html`, `flows.html` | The two screens |
| `screens/` | Screenshots of the current state |

## Rules the mockups follow
- 2px radius, no shadows, gradients or blur; 1px hairlines between panels; one accent colour.
- Type scale 11/12/13/15/18/24; every number in IBM Plex Mono with tabular figures, right-aligned.
- Units live in the panel or column header (₹ cr, US$ mn, %), never in the cell. ₹ uses Indian grouping, US$ uses Western.
- Dates are `13-Nov-26`. Negative numbers use a true minus sign. A value that rounds to zero shows `0`, uncoloured.
- Every panel names its source in the footer. Grade tags: `A` regulator/exchange data, `C` news-derived. Grade C rows are never added into any total.

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
