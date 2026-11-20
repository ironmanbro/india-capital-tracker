# Source licensing decision log

**Status: no decisions recorded yet.** Milestone 0 found that the product republishes data from sources whose redistribution terms were never reviewed
(`pipeline/SOURCES.md`, `.gitignore`, and the project's own `source_registry`, which marks NSE and BSE sources `restricted`).
This file is where each decision is recorded. It is a tracking sheet, **not legal advice**; the "Prior" column is the repo's own
evidence, not a conclusion about what the publisher's terms say. Nobody has read the publishers' terms yet.

Options per source: **KEEP** (terms allow it, record the clause) · **LINK-ONLY** (show a link and our own facts, not their records) ·
**REPLACE** (use an official, redistributable alternative) · **LICENSE** (negotiate a licence) · **REMOVE**.
Rule of thumb from the project owner's preferences: free/official first; paid vendors only if no free route exists.

| # | Source | What we store/show | Prior (repo evidence) | Terms URL checked? | Decision | Decided by / date | Notes |
|---|---|---|---|---|---|---|---|
| 1 | NSE bulk/block deals | rows + our events | `source_registry`: restricted; `.gitignore`: "terms not reviewed" | no | PENDING | | Highest-priority review |
| 2 | NSE shareholding patterns / masters | holders, % | restricted | no | PENDING | | |
| 3 | NSE FII/DII, IPO, announcements, corp. actions, holidays | rows | restricted | no | PENDING | | |
| 4 | BSE bulk/block deals, filings | rows | restricted; BSE blocks GitHub; pushed from owner's PC | no | PENDING | | Workaround increases risk |
| 5 | NSDL FPI flows, registry, limits | daily/monthly flows, 12.4k registrants incl. addresses | not assessed | no | PENDING | | Registry holds names and addresses |
| 6 | FBIL reference rates | FX series since 2018 | not assessed | no | PENDING | | Free alternative in use elsewhere: ECB via Frankfurter |
| 7 | SEBI / RBI / IFSCA / DPIIT / CCI / CCIL publications | rules, tables, orders | government sites; DPIIT shows `blocked` in registry test | no | PENDING | | Confirm attribution wording per site |
| 8 | Google News RSS + publisher feeds | headlines, snippets, links | not assessed | no | PENDING | | Consider storing links + own structured fields only |
| 9 | Wikipedia / Wikidata | investor summaries | CC BY-SA (Wikipedia text) / CC0 (Wikidata) [unverified here] | no | PENDING | | Attribution needed if text is shown |
| 10 | Investors' own websites | titles, descriptions | robots.txt respected | no | PENDING | | |
| 11 | Deloitte withholding-tax table | table copied into page | secondary source | no | PENDING | | |
| 12 | IFSCA contact details | names, phones, emails | published by IFSCA | no | PENDING | | Personal-data (DPDP) question |
| 13 | SEC EDGAR 13F | filings | public | no | PENDING | | Replace personal email in User-Agent |
| 14 | Anthropic API output | classifications derived from headlines | n/a | no | PENDING | | Check commercial terms |

When a row is decided: fill Decision, who/when, quote the clause or contact, then open an issue for the code change.
