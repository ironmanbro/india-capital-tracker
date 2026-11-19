"""Regression tests for Deal Outcomes (no network). Run: python3 pipeline/site_v2/tests/test_scorecard.py"""
import datetime as dt, os, sys, tempfile, urllib.error
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, ".."))
import nse_prices as npx, build_scorecard as bs
ok = True
def check(name, cond):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name)

# 1. classification: funds that look like banks or dealers, legal suffixes alone, individuals
for n, w in {"GOLDMAN SACHS FUNDS - GOLDMAN SACHS INDIA EQUITY PORTFOLIO": "fund", "GQG PARTNERS EMERGING MARKETS EQUITY FUND": "fund", "GOLDMAN SACHS BANK EUROPE SE - ODI": "odi",
             "GOLDMAN SACHS BANK EUROPE SE": "bank", "GRAVITON RESEARCH CAPITAL LLP": "dealer", "ARIHANT CAPITAL MARKETS LIMITED": "dealer", "WESTBRIDGE CROSSOVER FUND LLC": "fund",
             "BAYER AG": None, "NIRMA LIMITED": None, "SAGILITY B.V.": None, "RAKESH CHOPDAR": None, "NITN KAPOOR AND HUF": None, "SMALLCAP WORLD FUND INC": "fund"}.items():
    check(f"class of {n[:45]} is {w}", bs.klass(n) == w)

# 2. split and bonus arithmetic: a 1:1 bonus (factor 0.5) between trade and horizon
A = npx.Actions.__new__(npx.Actions); A.data = {"X": {"at": "2026-01-01", "a": [["2026-02-01", "BONUS", 0.5, "Bonus 1:1"], ["2026-03-01", "SPLIT", 0.2, "split"]]}}
f, hit = A.factor("X", dt.date(2026, 1, 15), dt.date(2026, 2, 15))
check("one bonus in the window gives factor 0.5", f == 0.5 and len(hit) == 1)
check("price 100 before a 1:1 bonus, 50 after, is a 0% move", abs(50 / (100 * f) - 1) < 1e-9)
f2, _ = A.factor("X", dt.date(2026, 1, 15), dt.date(2026, 3, 15)); check("bonus then split multiply (0.5 x 0.2 = 0.1)", abs(f2 - 0.1) < 1e-12)
f3, _ = A.factor("X", dt.date(2026, 2, 1), dt.date(2026, 2, 20)); check("an ex-date equal to the trade date is not adjusted (already post-event)", f3 == 1.0)
check("an unknown symbol gives None, never 'no actions'", A.factor("NOPE", dt.date(2026, 1, 1), dt.date(2026, 2, 1))[0] is None)

# 3. price files: stale file on a holiday, blocked response, genuine file
npx.CACHE = tempfile.mkdtemp()
def bhav(day): return "SYMBOL, SERIES, DATE1, PREV_CLOSE, OPEN_PRICE, HIGH_PRICE, LOW_PRICE, LAST_PRICE, CLOSE_PRICE, AVG_PRICE\nABC, EQ, %s, 1, 1, 1, 1, 1, 123.4, 1\n" % day
IDX = "Index Name,Index Date,Open Index Value,High Index Value,Low Index Value,Closing Index Value\nNifty 500,%s,1,1,1,1000.5\nNifty 50,%s,1,1,1,500.5\n"
state = {"mode": "stale"}
def fake_get(url, tries=3):
    if state["mode"] == "blocked": raise RuntimeError("fetch failed: 403")
    if "bhav" in url:
        return bhav("23-Jan-2026" if state["mode"] == "stale" else "26-Jan-2026")
    return IDX % (("23-01-2026",) * 2 if state["mode"] == "stale" else ("26-01-2026",) * 2)
npx._get = fake_get
P = npx.Prices({"ABC"}, budget=50); P.today = dt.date(2026, 11, 19)
check("a stale file served on a holiday is not a trading day", P._fetch_day(dt.date(2026, 1, 26)) is False and P.days["2026-01-26"] == 0 and "2026-01-26" not in P.close.get("ABC", {}))
state["mode"] = "blocked"; P2 = npx.Prices({"ABC"}, budget=50); P2.today = dt.date(2026, 11, 19)
check("a blocked response is an error and is NOT remembered as 'no trading'", P2._fetch_day(dt.date(2026, 1, 27)) is None and "2026-01-27" not in P2.days)
state["mode"] = "good"; P3 = npx.Prices({"ABC"}, budget=50); P3.today = dt.date(2026, 11, 19)
check("a genuine file is accepted with close and index values", P3._fetch_day(dt.date(2026, 1, 26)) is True and P3.px("ABC", dt.date(2026, 1, 26)) == 123.4 and P3.bench(dt.date(2026, 1, 26)) == 1000.5)
state["mode"] = "stale"; P4 = npx.Prices({"ABC"}, budget=50); P4.today = dt.date(2026, 1, 27)
check("a missing file for a RECENT date is not remembered (it may be unpublished)", P4._fetch_day(dt.date(2026, 1, 26)) is False and "2026-01-26" not in P4.days)
check("weekends are skipped without a request", P3._fetch_day(dt.date(2026, 1, 25)) is False)
print("all passed" if ok else "FAILED"); sys.exit(0 if ok else 1)
