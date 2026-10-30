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
EXTRA = ("startup_funding_news", "sec_13f_filings_index", "sec_13f_holdings_latest", "dpiit_fdi_publications", "gdelt_india_investments", "fx_usd_inr", "nse_announcements", "pib_releases")
# dataset -> (file, key function). Time series keep the date in the key so history accumulates;
# snapshots are keyed by entity and overwritten.
def deals(d):
    for k, v in d.items():
        if k.endswith("_DATA") and isinstance(v, list):
            for r in v:
                yield r, "|".join([k[:-5], r.get("date") or "", r.get("symbol") or "", r.get("clientName") or "",
                                   r.get("buySell") or "", str(r.get("qty"))]), r.get("date")


def iso_date(v):
    """Any of the date styles the exchanges and regulators use -> 'YYYY-MM-DD', or None."""
    t = str(v or "").strip().split("T")[0]
    for f in ("%Y-%m-%d", "%d-%b-%Y", "%d %b %Y", "%d %B %Y", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%b %d, %Y", "%B %d, %Y", "%d %B, %Y"):
        try:
            return datetime.strptime(t, f).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def _num(v):
    try:
        return float(str(v).replace(",", "").strip())
    except ValueError:
        return None


def bse_rows(kind, rows_):
    """BSE deal rows (whatever column names its feed or a downloaded file uses) -> the NSE field names the site reads."""
    def pick(r, *pats):
        keys = {re.sub(r"[^a-z0-9]", "", str(k).lower()): v for k, v in r.items()}
        for pat in pats:
            for k, v in keys.items():
                if re.search(pat, k) and v not in (None, ""):
                    return v
        return None
    out = []
    for r in rows_ if isinstance(rows_, list) else []:
        if not isinstance(r, dict):
            continue
        d = iso_date(pick(r, r"dealdate", r"tradedate", r"date"))
        client = str(pick(r, r"clientname", r"client") or "").strip()
        qty, price = _num(pick(r, r"^qty", r"quantity", r"noofshares")), _num(pick(r, r"tradeprice", r"price", r"wap", r"rate"))
        side = str(pick(r, r"buysell", r"^bs$", r"dealtype", r"transactiontype", r"buyorsell") or "").strip().lower()
        if not (d and client and qty and side):
            continue
        buy = side.startswith(("b", "p"))
        sell = side.startswith("s")
        if not (buy or sell):
            continue
        name = str(pick(r, r"scripname", r"securityname", r"companyname", r"^name$") or "").strip()
        code = str(pick(r, r"scripcode", r"scripcd", r"securitycode", r"^code$") or "").strip()
        out.append({"date": datetime.strptime(d, "%Y-%m-%d").strftime("%d-%b-%Y"), "symbol": code or name, "code": code, "name": name or code,
                    "clientName": client, "buySell": "BUY" if buy else "SELL", "qty": str(int(qty)), "watp": str(price if price is not None else ""),
                    "exchange": "BSE", "kind": kind, "remarks": str(pick(r, r"remark") or "")})
    return out


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
    # BSE bulk and block deals (bse_deals.py, or bse_offline.py from a downloaded file), in the NSE field names.
    bse = {}
    for kind in ("bulk", "block"):
        p = os.path.join(directory, f"bse_{kind}_deals.json")
        if os.path.exists(p):
            for n in bse_rows(kind, json.load(open(p))):
                k = "|".join([f"BSE_{kind.upper()}", n["date"], n["code"] or n["symbol"], n["clientName"], n["buySell"], n["qty"]])
                bse[k] = {"dataset": "bse_deals", "key": k, "as_of": iso_date(n["date"]), "data": n, "loaded_at": now}
    if bse:
        out["bse_deals"] = bse
    # Competition Commission merger and acquisition approvals: one record per combination.
    p = os.path.join(directory, "cci_merger_approvals.json")
    if os.path.exists(p):
        out["cci"] = {}
        for r in json.load(open(p)):
            k = r.get("combination_no") or (r.get("parties") or "")[:80]
            if k:
                out["cci"][k] = {"dataset": "cci", "key": k, "as_of": iso_date(r.get("decision_date")) or iso_date(r.get("notification_date")), "data": r, "loaded_at": now}
    # RBI: weekly reserves keep one record per week (history builds up); the other files are kept whole.
    rd = os.path.join(directory, "rbi")
    if os.path.isdir(rd):
        for fn in sorted(os.listdir(rd)):
            if not fn.endswith(".json"):
                continue
            body = json.load(open(os.path.join(rd, fn)))
            if fn == "weekly_reserves.json":
                out["rbi_reserves"] = {r["as_on"]: {"dataset": "rbi_reserves", "key": r["as_on"], "as_of": iso_date(r["as_on"]), "data": r, "loaded_at": now} for r in body if r.get("as_on")}
            elif len(json.dumps(body)) < 4_000_000:
                out.setdefault("rbi", {})[fn[:-5]] = {"dataset": "rbi", "key": fn[:-5], "as_of": None, "data": body, "loaded_at": now}
            else:
                print(f"rbi/{fn}: too large to store, skipped")
    # Extra sources (SEBI, startup news, SEC 13F, NSE extras, DPIIT, GDELT): each file is kept whole under dataset "extra".
    ex = {}
    for root, _, files in os.walk(directory):
        rel = os.path.relpath(root, directory)
        if rel.split(os.sep)[0] in ("rbi", "nsdl"):
            continue
        for fn in sorted(files):
            if not fn.endswith(".json") or fn.split(".")[0] not in EXTRA and rel not in ("sebi", "exchange"):
                continue
            body = json.load(open(os.path.join(root, fn)))
            k = fn[:-5] if rel == "." else f"{rel}/{fn[:-5]}"
            if len(json.dumps(body)) < 4_000_000:
                ex[k] = {"dataset": "extra", "key": k, "as_of": None, "data": body, "loaded_at": now}
            else:
                print(f"{k}: too large to store, skipped")
    if ex:
        out["extra"] = ex
    # NSDL report pages: one record per file (a list of {title, rows} tables). The full FPI list is skipped; fpi_registry has it.
    nd = os.path.join(directory, "nsdl")
    if os.path.isdir(nd):
        out["nsdl"] = {}
        for fn in sorted(os.listdir(nd)):
            if fn.endswith(".json") and fn != "list_of_fpis.json":
                k = fn[:-5]
                out["nsdl"][k] = {"dataset": "nsdl", "key": k, "as_of": None, "data": json.load(open(os.path.join(nd, fn))), "loaded_at": now}
    return {n: list(v.values()) for n, v in out.items()}


def _event(r, kind, exch, page):
    client = r.get("clientName") or ""
    if not (FOREIGN.search(client) and not DOMESTIC.search(client)):
        return None
    buy = (r.get("buySell") or "").upper().startswith("B")
    try:
        value = float(str(r["qty"]).replace(",", "")) * float(str(r["watp"]).replace(",", ""))
        published = datetime.strptime(r["date"], "%d-%b-%Y").replace(tzinfo=timezone.utc).isoformat()
    except (KeyError, TypeError, ValueError):
        return None
    ev = "entry" if buy else "exit"
    target = r.get("name") or r.get("symbol")
    low = exch.lower()
    return {
        "dedup_key": f"nse_api_{kind}:{r['date']}:{r.get('symbol')}:{client}:{r.get('buySell')}:{r['qty']}" if exch == "NSE" else f"bse_{kind}:{r['date']}:{r.get('code') or r.get('symbol')}:{client}:{r.get('buySell')}:{r['qty']}",
        "source": f"{low}_{kind}", "source_name": exch, "url": page,
        "title": f"{client} {'bought' if buy else 'sold'} {target} shares worth ₹{value / 1e7:.1f} cr ({kind} deal on {exch})" if exch != "NSE" else f"{client} {'bought' if buy else 'sold'} {target} shares worth ₹{value / 1e7:.1f} cr ({kind} deal)",
        "published_at": published, "event_type": ev, "event_types": [ev],
        "parties": [{"name": client, "role": "buyer" if buy else "seller", "type": "fpi"}],
        "investor": client, "investor_type": "fpi", "target": target,
        "amount_usd_m": round(value / INR_PER_USD / 1e6, 1), "amount_text": f"₹{value / 1e7:.1f} cr",
        "priority": 3 if buy else 2, "confidence": 0.9, "classifier": "structured", "query_tag": f"{low}_{kind}", "raw": r,
    }


def deal_events(d):
    """Foreign-client NSE bulk and block deals as `events` rows, shaped like the ingest function's NSE rows."""
    out = []
    for k, kind in (("BULK_DEALS_DATA", "bulk"), ("BLOCK_DEALS_DATA", "block")):
        for r in d.get(k) or []:
            e = _event(r, kind, "NSE", "https://www.nseindia.com/report-detail/display-bulk-and-block-deals")
            if e:
                out.append(e)
    return out


def bse_events(recs):
    out = []
    for rec in recs:
        r = rec["data"]
        e = _event(r, r["kind"], "BSE", f"https://www.bseindia.com/markets/equity/EQReports/{r['kind']}_deals.aspx")
        if e:
            out.append(e)
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
    evs = deal_events(json.load(open(f))) if os.path.exists(f) else []
    evs += bse_events(data.get("bse_deals", []))
    if evs:
        print(f"events (foreign bulk/block, NSE and BSE): {len(evs)}")
        if "--dry-run" not in argv and url and key:
            post(url, key, "events", "dedup_key", evs, "ignore-duplicates")


if __name__ == "__main__":
    main(sys.argv[1:])
