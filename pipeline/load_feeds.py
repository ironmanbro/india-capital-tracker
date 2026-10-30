"""Load the collector JSON files in data/ into Supabase table feed_records (stdlib only, idempotent).

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never logged). Usage: python3 pipeline/load_feeds.py [data] [--dry-run]
"""
import json, os, sys, urllib.request
from datetime import datetime, timezone

BATCH = 500
# dataset -> (file, key function). Time series keep the date in the key so history accumulates;
# snapshots are keyed by entity and overwritten.
def deals(d):
    for k, v in d.items():
        if k.endswith("_DATA") and isinstance(v, list):
            for r in v:
                yield r, "|".join([k[:-5], r.get("date") or "", r.get("symbol") or "", r.get("clientName") or "",
                                   r.get("buySell") or "", str(r.get("qty"))]), r.get("date")

def rows(f):
    d = json.load(open(f))
    return d if isinstance(d, list) else [d]

DATASETS = {
    "nse_shareholding": ("nse_shareholding_cleaned.json", lambda r: (r.get("isin") or r["symbol"], r.get("date"))),
    "fii_dii": ("fii_dii_daily.json", lambda r: (f"{r['date']}|{r['category']}", r["date"])),
    "ipo_current": ("ipo_current_issue.json", lambda r: (f"{r['symbol']}|{r.get('category')}", r.get("issueStartDate"))),
    "ipo_upcoming": ("ipo_upcoming_issues.json", lambda r: (r["symbol"], r.get("issueStartDate"))),
    "fpi_debt_summary": ("fpi_debt_utilization_summary.json", lambda r: (r["Instrument Type"], None)),
    "fpi_far_gsec": ("fpi_far_gsec_holdings.json", lambda r: (r["ISIN"], None)),
    "fpi_general_gsec": ("fpi_general_gsec_holdings.json", lambda r: (r["ISIN"], None)),
    "fpi_sdl": ("fpi_sdl_holdings.json", lambda r: (r["ISIN"], None)),
    "fpi_tbill": ("fpi_tbill_holdings.json", lambda r: (r["ISIN"], None)),
    "fpi_sector": ("fpi_sector_allocations.json", lambda r: (r["Sectors"], None)),
}


def collect(directory):
    now = datetime.now(timezone.utc).isoformat()
    out = {}
    for name, (fn, keyfn) in DATASETS.items():
        p = os.path.join(directory, fn)
        if os.path.exists(p):
            out[name] = {}
            for r in rows(p):
                k, as_of = keyfn(r)
                out[name][k] = {"dataset": name, "key": k, "as_of": as_of, "data": r, "loaded_at": now}
    p = os.path.join(directory, "bulk_block_deals.json")
    if os.path.exists(p):
        out["nse_deals"] = {}
        for r, k, as_of in deals(json.load(open(p))):
            out["nse_deals"][k] = {"dataset": "nse_deals", "key": k, "as_of": as_of, "data": r, "loaded_at": now}
    return {n: list(v.values()) for n, v in out.items()}


def main(argv):
    directory = next((a for a in argv if not a.startswith("--")), "data")
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    data = collect(directory)
    for name, recs in data.items():
        print(f"{name}: {len(recs)} records")
        if "--dry-run" in argv or not (url and key):
            continue
        for i in range(0, len(recs), BATCH):
            req = urllib.request.Request(f"{url}/rest/v1/feed_records?on_conflict=dataset,key",
                                         data=json.dumps(recs[i:i + BATCH]).encode(), method="POST",
                                         headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                                  "Prefer": "resolution=merge-duplicates,return=minimal"})
            urllib.request.urlopen(req, timeout=60).close()


if __name__ == "__main__":
    main(sys.argv[1:])
