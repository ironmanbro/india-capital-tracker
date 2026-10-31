"""Backfill from April 2025: NSE bulk/block deals with foreign-looking clients, and NSDL FPI monthly net investment by calendar year.
Output: data/history/bulk_block_deals_history.json and data/history/fpi_monthly_history.json (loaded by pipeline/load_feeds.py)."""
import os, re, sys, json, time, datetime as dt, requests
from bs4 import BeautifulSoup

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from load_feeds import FOREIGN, DOMESTIC  # same foreign-name test as the live feed
import nsdl_all

START = dt.date.fromisoformat(os.environ.get("HISTORY_FROM", "2025-04-01"))
os.makedirs("data/history", exist_ok=True)
bad = []

# ---- NSE bulk and block deals, one month at a time ----
H = {"User-Agent": nsdl_all.H["User-Agent"], "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate",
     "Referer": "https://www.nseindia.com/report-detail/display-bulk-and-block-deals"}
FIELDS = {"date": ("BD_DT_DATE", "date"), "symbol": ("BD_SYMBOL", "symbol"), "name": ("BD_SCRIP_NAME", "securityName"), "clientName": ("BD_CLIENT_NAME", "clientName"),
          "buySell": ("BD_BUY_SELL", "buySell"), "qty": ("BD_QTY_TRD", "quantityTraded"), "watp": ("BD_TP_WATP", "tradePrice"), "remarks": ("BD_REMARKS", "remarks")}


def deals_history():
    s = requests.Session(); s.headers.update(H)
    s.get("https://www.nseindia.com/", timeout=30)
    out = {"BULK_DEALS_DATA": [], "BLOCK_DEALS_DATA": []}
    d, today = START, dt.date.today()
    while d <= today:
        end = min(d + dt.timedelta(days=29), today)
        for opt, key in (("bulk_deals", "BULK_DEALS_DATA"), ("block_deals", "BLOCK_DEALS_DATA")):
            r = s.get("https://www.nseindia.com/api/historicalOR/bulk-block-short-deals", params={"optionType": opt, "from": f"{d:%d-%m-%Y}", "to": f"{end:%d-%m-%Y}"}, timeout=90)
            r.raise_for_status()
            j = r.json()
            rows = j["data"] if isinstance(j, dict) and "data" in j else j
            if not out[key] and rows and d == START:
                print("sample row keys:", sorted(rows[0])[:12])
            for x in rows:
                n = {k: next((x[a] for a in alts if x.get(a) not in (None, "")), "") for k, alts in FIELDS.items()}
                n["buySell"] = {"B": "BUY", "S": "SELL"}.get(str(n["buySell"]).strip().upper()[:1], str(n["buySell"]).upper())
                n["qty"] = str(n["qty"]).replace(",", "")
                if n["clientName"] and FOREIGN.search(n["clientName"]) and not DOMESTIC.search(n["clientName"]):
                    out[key].append(n)
            time.sleep(1)
        print(f"deals {d} to {end}: {len(out['BULK_DEALS_DATA'])} bulk, {len(out['BLOCK_DEALS_DATA'])} block so far", flush=True)
        d = end + dt.timedelta(days=1)
    assert out["BULK_DEALS_DATA"] or out["BLOCK_DEALS_DATA"], "no foreign deals found"
    json.dump(out, open("data/history/bulk_block_deals_history.json", "w"), indent=1, ensure_ascii=False)


# ---- NSDL monthly net investment, calendar years from START ----
SEG = {"Total": "Total", "Equity": "Equity", "Hybrid": "Hybrid", "Debt_Debt-FAR": "Debt-FAR", "Debt_Debt-VRR": "Debt-VRR", "Debt_Debt-General Limit": "Debt-General Limit",
       "Mutual Funds_Debt": "MF Debt", "Mutual Funds_Other": "MF Other", "Mutual Funds_Equity": "MF Equity", "Mutual Funds_Hybrid": "MF Hybrid",
       "Mutual Funds_Solution Oriented": "MF Solution Oriented", "Alternative Investment Funds(AIFs)_AIF": "AIF"}
MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"]


def monthly_history():
    url = nsdl_all.B + "Reports/Yearwise.aspx?RptType=6"
    s = requests.Session(); s.headers.update(nsdl_all.H)
    page = s.get(url, timeout=45).text
    sel = BeautifulSoup(page, "html.parser").find("select")
    assert sel, "no year picker on the NSDL page"
    years = [o.get("value") for o in sel.find_all("option") if (o.get("value") or "").isdigit() and int(o["value"]) >= START.year]
    rows = []
    for y in years:
        form = nsdl_all.hidden_fields(page)
        form.update({"__EVENTTARGET": sel["name"], "__EVENTARGUMENT": "", sel["name"]: y})
        html = s.post(url, data=form, timeout=45).text
        for t in nsdl_all.tables(html):
            for r in t["rows"]:
                m = MONTHS.index(str(r.get("Calendar Year", "")).strip().lower()) + 1 if str(r.get("Calendar Year", "")).strip().lower() in MONTHS else 0
                if not m:
                    continue
                for col, v in r.items():
                    seg = "Total" if col == "INR Crores_Total" else next((n for k, n in SEG.items() if col.endswith("INR Crores_" + k)), None)
                    if seg and isinstance(v, (int, float)):
                        rows.append({"month": f"{y}-{m:02d}-01", "segment": seg, "net_cr": v})
        print("monthly", y, len(rows), "rows so far", flush=True)
        time.sleep(1)
    assert rows, "no monthly rows"
    json.dump(rows, open("data/history/fpi_monthly_history.json", "w"), indent=1)


for fn in (deals_history, monthly_history):
    try:
        fn()
    except Exception as e:
        print("FAILED", fn.__name__, repr(e)[:300])
        bad.append(fn.__name__)
print("Failed:", bad or "none")
sys.exit(1 if bad else 0)
