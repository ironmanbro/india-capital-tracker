"""Links a news-reported deal (grade C) to the exchange deal (grade A) it describes, by company name and date.

Why: the same block or bulk deal often appears twice, once from NSE's file and once from the news. The Deals page folds
a matched news row into its exchange deal ("+ news") instead of listing the deal twice.

Rules, chosen to be strict (a missed match only costs a duplicate row; a wrong match hides a real deal):
- Dates within 3 days (news can run a day or two before or after the trade is filed).
- Direction is ignored: one block deal has a seller and buyers, so "X sells" and "Y buys" can be the same trade.
- Company names are compared on their significant words, in order. Each news name variant (the main name, and a name in
  brackets such as "Groww (Billionbrains Garage Ventures)") is tried against the NSE name. Two words match when one is
  a prefix of the other, which handles NSE's abbreviations ("Clean Max Enviro En Sol L", "Billionbrains Garage Vn L").
  The first two significant words must match; a one-word name must match the NSE name's only significant word.
  So "IIFL Finance" does not match "IIFL CAPITAL SERVICES LTD", and "Meesho" matches "Meesho Limited".
- When several exchange deals qualify, the closest date wins, then the largest.
"""
import datetime as dt, re

LEGAL = {"ltd", "l", "limited", "inc", "llc", "llp", "plc", "pte", "pvt", "private", "the", "co", "corp", "corporation", "sa", "ag", "nv", "bv", "and", "of", "india", "indian"}
MIN_PREFIX = 3   # a word shorter than this never matches by prefix ("en" -> "energy" needs the earlier words to agree too)

def words(name):
    return [w for w in re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).split() if w not in LEGAL]

def variants(name):
    """The main name and any name in brackets, as word lists."""
    s = name or ""
    out = [words(re.sub(r"\(.*?\)", " ", s))] + [words(x) for x in re.findall(r"\((.*?)\)", s)]
    return [v for v in out if v]

def _w(a, b):
    if a == b: return True
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) >= 2 and long_.startswith(short) and (len(short) >= MIN_PREFIX or len(long_) > len(short))

def same_company(news_name, nse_name):
    n = words(nse_name)
    if not n: return False
    for v in variants(news_name):
        if len(v) == 1:
            if len(n) == 1 and _w(v[0], n[0]) and min(len(v[0]), len(n[0])) >= 3: return True
            continue
        if len(n) >= 2 and _w(v[0], n[0]) and _w(v[1], n[1]) and len(v[0]) >= 3: return True
    return False

def match(news_rows, exchange_rows, days=3):
    """Sets row["mk"] = {"d": date, "tgt": NSE name} on each matched news row; returns the number matched."""
    day = lambda s: dt.date.fromisoformat(s).toordinal()
    n = 0
    for c in news_rows:
        if c.get("ev") not in ("entry", "exit") or not c.get("tgt"): continue
        best = None
        for a in exchange_rows:
            gap = abs(day(a["d"]) - day(c["d"]))
            if gap > days or not same_company(c["tgt"], a.get("tgt")): continue
            k = (gap, -(a.get("usd") or 0))
            if best is None or k < best[0]: best = (k, a)
        if best:
            c["mk"] = {"d": best[1]["d"], "tgt": best[1]["tgt"]}; n += 1
    return n
