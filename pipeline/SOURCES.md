# Source registry (status as tested from the build sandbox, 2026-10-29)

| Source | URL | Status | Evidence |
|---|---|---|---|
| NSE equities master | https://www.nseindia.com/api/corporate-share-holdings-master?index=equities | Unverified | Sandbox proxy refused the connection (`connect_rejected`); JSON schema, `xbrl` type, history depth NOT inspected |
| NSE SME master | ...?index=sme | Unverified | Same |
| BSE shareholding collector | (no endpoint verified) | Disabled | `pipeline/bse_master.py` is a tested interface only; needs `bse_config.json` after BSE endpoint and licence are verified |
| BSE notices XML | https://www.bseindia.com/data/xml/notices.xml | Unverified | Proxy refused; BSE shareholding endpoints not investigated |
| SEBI RSS | https://www.sebi.gov.in/sebirss.xml | Unverified | Proxy refused |
| Others in the brief (CCI, DPIIT, RBI, IFSCA, EDGAR, news) | per brief | Unverified | Not tested |

Licensing (NSE/BSE storage and redistribution terms) not reviewed; review before production use.
Existing repo already ingests NSE shareholding RSS -> `shareholdings` table (Supabase `ingest/shp.ts`).
