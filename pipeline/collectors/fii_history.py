"""Try to backfill FII/DII daily cash-market activity from NSE. NSE documents no history option, so this probes a few likely
date parameters on a past week and only backfills if one of them returns that week's dates. Everything it tried is printed."""
import os, sys, json, time, datetime as dt, requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from load_feeds import iso_date

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
     "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate",
     "Referer": "https://www.nseindia.com/reports/fii-dii"}
START = dt.date.fromisoformat(os.environ.get("HISTORY_FROM", "2025-04-01"))
NSE = "https://www.nseindia.com/api/"
dmy, dmon = (lambda d: f"{d:%d-%m-%Y}"), (lambda d: f"{d:%d-%b-%Y}")
# (path, parameter builder for a from/to range, or None for a single date)
VARIANTS = [("fiidiiTradeReact", lambda a, b: {"from_date": dmy(a), "to_date": dmy(b)}), ("fiidiiTradeReact", lambda a, b: {"fromDate": dmy(a), "toDate": dmy(b)}),
            ("fiidiiTradeReact", lambda a, b: {"date": dmon(a)}), ("fiidiiTradeReact", lambda a, b: {"date": dmy(a)}),
            ("fiidiiTradeData", lambda a, b: {"from_date": dmy(a), "to_date": dmy(b)}), ("fiidiiTradeData", lambda a, b: {"date": dmon(a)}),
            ("historicalOR/fii-dii", lambda a, b: {"from": dmy(a), "to": dmy(b)})]

s = requests.Session(); s.headers.update(H)
s.get("https://www.nseindia.com/", timeout=30)


def call(path, params):
    try:
        r = s.get(NSE + path, params=params, timeout=45)
        j = r.json() if r.status_code == 200 else None
        rows = j["data"] if isinstance(j, dict) and isinstance(j.get("data"), list) else j if isinstance(j, list) else []
        return r.status_code, [x for x in rows if isinstance(x, dict) and x.get("date")]
    except Exception as e:
        return repr(e)[:80], []


a, b = dt.date(2025, 4, 14), dt.date(2025, 4, 18)
working = None
for path, build in VARIANTS:
    code, rows = call(path, build(a, b))
    days = {iso_date(r["date"]) for r in rows}
    ok = bool(days) and all(d and a.isoformat() <= d <= b.isoformat() for d in days)
    print(f"probe {path} {build(a, b)} -> {code}, {len(rows)} rows, dates {sorted(x for x in days if x)[:6]}, usable={ok}", flush=True)
    if ok:
        working = (path, build, len(days) > 1)
        break
    time.sleep(1)
assert working, "no date option worked; history keeps building from the daily run"

path, build, ranged = working
out, d, today = [], START, dt.date.today()
while d <= today:
    end = min(d + dt.timedelta(days=29), today) if ranged else d
    if ranged or d.weekday() < 5:
        code, rows = call(path, build(d, end))
        out += [r for r in rows if (iso_date(r["date"]) or "") >= d.isoformat() and (iso_date(r["date"]) or "") <= end.isoformat()]
        time.sleep(0.7)
    d = end + dt.timedelta(days=1)
    if len(out) and len(out) % 100 < 2:
        print("rows so far", len(out), flush=True)
uniq = {(r["date"], r.get("category")): r for r in out}
os.makedirs("data/history", exist_ok=True)
json.dump(list(uniq.values()), open("data/history/fii_dii_history.json", "w"), indent=1)
print("saved", len(uniq), "FII/DII rows")
