"""Load the collector JSON files in data/ into Supabase table feed_records (stdlib only, idempotent).

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never logged). Usage: python3 pipeline/load_feeds.py [data] [--dry-run]
"""
import json, os, re, sys, urllib.request
from datetime import datetime, timezone

BATCH = 500
# Same foreign-client heuristic as supabase/functions/ingest/index.ts; keep the two in step.
FOREIGN = re.compile(r"\b(PTE|LLC|L\.?P\.?|PLC|SICAV|ICAV|S\.?A\.?|SARL|GMBH|AG|INC|N\.?V\.?|B\.?V\.?|MAURITIUS|SINGAPORE|CAYMAN|IRELAND|LUXEMBOURG|NORWAY|ABU DHABI|DUBAI|QATAR|KUWAIT|SAUDI|JAPAN|KOREA|TAIWAN|HONG KONG|CANADA|AUSTRALIA|MASTER FUND|FEEDER|OFFSHORE|EMERGING MARKETS?|GOVERNMENT OF|MONETARY AUTHORITY|INVESTMENT AUTHORITY|PENSION|SOVEREIGN|ODI|FPI|GOLDMAN SACHS|MORGAN STANLEY|CITIGROUP|BNP PARIBAS|SOCIETE GENERALE|J\.?P\.? ?MORGAN|BOFA|MERRILL|NOMURA|UBS|CLSA|VANGUARD|BLACKROCK|GIC|NORGES|TEMASEK|FIDELITY|ABERDEEN|MACQUARIE|HSBC|BARCLAYS|CITADEL|JANE STREET|SOCIETE)\b", re.I)
DOMESTIC = re.compile(r"(MUTUAL FUND|\bMF\b|INSURANCE|\bHUF\b|PRIVATE LIMITED|PVT\.? LTD|BROKING|SHARE BROKERS)", re.I)
INR_PER_USD = 88
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
    # NSDL report pages: one record per file (a list of {title, rows} tables). The full FPI list is skipped; fpi_registry has it.
    nd = os.path.join(directory, "nsdl")
    if os.path.isdir(nd):
        out["nsdl"] = {}
        for fn in sorted(os.listdir(nd)):
            if fn.endswith(".json") and fn != "list_of_fpis.json":
                k = fn[:-5]
                out["nsdl"][k] = {"dataset": "nsdl", "key": k, "as_of": None, "data": json.load(open(os.path.join(nd, fn))), "loaded_at": now}
    return {n: list(v.values()) for n, v in out.items()}


def deal_events(d):
    """Foreign-client bulk and block deals as `events` rows, shaped like the ingest function's NSE rows."""
    out = []
    for k, kind in (("BULK_DEALS_DATA", "bulk"), ("BLOCK_DEALS_DATA", "block")):
        for r in d.get(k) or []:
            client = r.get("clientName") or ""
            if not (FOREIGN.search(client) and not DOMESTIC.search(client)):
                continue
            buy = (r.get("buySell") or "").upper().startswith("B")
            try:
                value = float(r["qty"]) * float(r["watp"])
                published = datetime.strptime(r["date"], "%d-%b-%Y").replace(tzinfo=timezone.utc).isoformat()
            except (KeyError, TypeError, ValueError):
                continue
            ev = "entry" if buy else "exit"
            target = r.get("name") or r.get("symbol")
            out.append({
                "dedup_key": f"nse_api_{kind}:{r['date']}:{r.get('symbol')}:{client}:{r.get('buySell')}:{r['qty']}",
                "source": f"nse_{kind}", "source_name": "NSE",
                "url": "https://www.nseindia.com/report-detail/display-bulk-and-block-deals",
                "title": f"{client} {'bought' if buy else 'sold'} {target} shares worth ₹{value / 1e7:.1f} cr ({kind} deal)",
                "published_at": published, "event_type": ev, "event_types": [ev],
                "parties": [{"name": client, "role": "buyer" if buy else "seller", "type": "fpi"}],
                "investor": client, "investor_type": "fpi", "target": target,
                "amount_usd_m": round(value / INR_PER_USD / 1e6, 1), "amount_text": f"₹{value / 1e7:.1f} cr",
                "priority": 3 if buy else 2, "confidence": 0.9, "classifier": "structured", "query_tag": f"nse_{kind}", "raw": r,
            })
    return out


def post(url, key, table, conflict, recs, resolution="merge-duplicates"):
    for i in range(0, len(recs), BATCH):
        req = urllib.request.Request(f"{url}/rest/v1/{table}?on_conflict={conflict}",
                                     data=json.dumps(recs[i:i + BATCH]).encode(), method="POST",
                                     headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                              "Prefer": f"resolution={resolution},return=minimal"})
        urllib.request.urlopen(req, timeout=60).close()


def main(argv):
    directory = next((a for a in argv if not a.startswith("--")), "data")
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    data = collect(directory)
    for name, recs in data.items():
        print(f"{name}: {len(recs)} records")
        if "--dry-run" in argv or not (url and key):
            continue
        post(url, key, "feed_records", "dataset,key", recs)
    f = os.path.join(directory, "bulk_block_deals.json")
    if os.path.exists(f):
        evs = deal_events(json.load(open(f)))
        print(f"events (foreign bulk/block): {len(evs)}")
        if evs and "--dry-run" not in argv and url and key:
            post(url, key, "events", "dedup_key", evs, "ignore-duplicates")


if __name__ == "__main__":
    main(sys.argv[1:])
