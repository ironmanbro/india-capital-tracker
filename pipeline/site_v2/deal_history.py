"""Was an exchange buy a top-up of a holding the investor already had?

For each exchange (grade A) buy:
  "added"  the investor already held the stock: a shareholding filing dated before the deal lists it (filings name holders of
           1% or more), or it bought the same stock on the exchange on an earlier day. The note says which.
  "first"  no earlier holding on record. This is NOT proof of a first purchase: smaller holdings (under 1%) are not named in
           filings, and the exchange record here starts in April 2025. The page says "first seen", never "new".

Names are compared with norm() (the SQL norm_name() twin), so "Fih Mauritius Investments Ltd" equals
"FIH MAURITIUS INVESTMENTS LTD"; companies with deal_match.same_company(). Confirmed aliases are not used here yet.
"""
import collections
from common import norm
from deal_match import same_company

def label(rows, shareholdings, past_buys):
    """rows: deals.js rows (only g == "A" and ev == "entry" are labelled, in place: pos, posn).
    shareholdings: dicts with company, period_end, holder, pct.  past_buys: dicts with d, inv, tgt (every exchange buy on record).
    Returns a Counter of the labels given."""
    shp = collections.defaultdict(list)
    for s in shareholdings:
        k = norm(s.get("holder"))
        if k: shp[k].append(s)
    buys = collections.defaultdict(list)
    for b in past_buys:
        k = norm(b.get("inv"))
        if k: buys[k].append(b)
    out = collections.Counter()
    for r in rows:
        if r.get("g") != "A" or r.get("ev") != "entry": continue
        k = norm(r.get("inv"))
        held = [s for s in shp.get(k, ()) if s["period_end"] < r["d"] and same_company(s["company"], r["tgt"])]
        if held:
            s = max(held, key=lambda s: s["period_end"])
            r["pos"], r["posn"] = "added", f"held {s['pct']:.2f}% at the {s['period_end']} shareholding filing"
        else:
            prev = [b for b in buys.get(k, ()) if b["d"] < r["d"] and same_company(b["tgt"], r["tgt"])]
            if prev:
                r["pos"], r["posn"] = "added", "bought on the exchange on " + max(b["d"] for b in prev)
            else:
                r["pos"] = "first"
        out[r["pos"]] += 1
    return out
