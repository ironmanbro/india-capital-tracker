"""limits.js: the Cap Radar (NSDL red flag and breach lists) plus a daily history of it.

NSDL's lists are replaced on every load (the table `fpi_limits` keeps only the latest report), so history cannot be read from the
database. Instead each build appends today's snapshot to the history already inside the committed site/v2/limits.js, so the page
can show what entered, left or moved since the last report. History therefore starts on the first build that ran this code; the
page says so and never invents earlier days."""
import json, os, re
from common import paged, built_stamp, BuildError

HERE = os.path.dirname(os.path.abspath(__file__))
OLD = os.environ.get("LIM_HISTORY", os.path.join(HERE, "..", "..", "site", "v2", "limits.js"))
KEEP = 400                      # snapshots kept (about 16 months of working days)
EVENTS = 60                     # most recent changes shown

def num(s):
    try: return float(s)
    except (TypeError, ValueError): return None

def qty(s):
    s = re.sub(r"[,\s]", "", s or "")
    return int(s) if s.isdigit() else None

def old_history():
    try:
        txt = open(OLD, encoding="utf-8").read()
        h = json.loads(re.sub(r"^window\.LIM=|;\s*$", "", txt))["hist"]
        if isinstance(h.get("snaps"), list) and isinstance(h.get("names"), dict): return h
    except (OSError, ValueError, KeyError, TypeError): pass
    return {"snaps": [], "names": {}}

def build():
    rows = []
    for r in paged("fpi_limits?select=list,as_of,company,isin,raw"):
        raw = r["raw"] or {}
        agg, cap = num(raw.get("aggregate investment (%)")), num(raw.get("aggregate permissible limit (%)"))
        if agg is None or not cap or not r["isin"]: continue
        rows.append(dict(isin=r["isin"], co=r["company"], l="B" if r["list"] == "breach" else "R", agg=agg, cap=cap, room=round(cap - agg, 2),
                         qty=qty(raw.get("available investment headroom (in terms of quantity)")), since=raw.get("date when red flag was activated") or raw.get("date when company was included in breach list"),
                         exch=raw.get("listed on stock exchange*"), sec=raw.get("security type"), asof=r["as_of"]))
    if not rows: raise BuildError("no rows on the NSDL limit lists")
    asof = max(r["asof"] for r in rows)
    if len({r["isin"] for r in rows}) != len(rows): raise BuildError("duplicate ISINs on the NSDL limit lists")

    h = old_history()
    names = dict(h["names"]); names.update({r["isin"]: r["co"] for r in rows})
    snaps = [s for s in h["snaps"] if s["d"] != asof]
    snaps.append({"d": asof, "c": {r["isin"]: [r["l"], r["agg"], r["cap"]] for r in rows}})
    snaps = sorted(snaps, key=lambda s: s["d"])[-KEEP:]

    # What changed between each report and the one before it.
    ev = []
    for a, b in zip(snaps, snaps[1:]):
        for i, (l, agg, cap) in b["c"].items():
            p = a["c"].get(i)
            if p is None: ev.append(dict(d=b["d"], i=i, t="in", l=l, agg=agg))
            elif p[0] != l: ev.append(dict(d=b["d"], i=i, t="up" if l == "B" else "down", l=l, agg=agg))
        for i, p in a["c"].items():
            if i not in b["c"]: ev.append(dict(d=b["d"], i=i, t="out", l=p[0], agg=p[1]))
    ev = sorted(ev, key=lambda e: (e["d"], e["t"]), reverse=True)[:EVENTS]
    live = {i for s in snaps[-EVENTS:] for i in s["c"]}
    return "LIM", dict(asof=asof, rows=sorted(rows, key=lambda r: (r["l"] != "B", -(r["agg"] / r["cap"]))), ev=ev,
                       hist={"snaps": snaps, "names": {i: n for i, n in names.items() if i in live or any(e["i"] == i for e in ev)}},
                       since=snaps[0]["d"], built=built_stamp())
