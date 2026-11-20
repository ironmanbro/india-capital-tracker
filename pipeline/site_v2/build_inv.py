"""inv.js: one row per investor NAME (news, exchange deals, shareholding filings), keyed like the database (norm_name).
Names are not merged here beyond norm_name(); confirmed aliases group them at view time (resolver.js) (Investors page)."""
import collections, datetime as dt, re
from common import paged, stories, norm, today, built_stamp, BuildError
import deal_quality

def build():
    T = today(); cut = (T - dt.timedelta(days=365)).isoformat()
    st = [s for s in stories() if s["investor"] and s["flow_kind"] == "capital"]
    shp = paged("shareholdings?select=company,period_end,holder,category,pct&order=period_end.desc")
    prof = paged("investor_profiles?select=holder,label,wikidata_id")
    I = {}
    def row(name):
        k = norm(name)
        if not k: return None
        o = I.get(k)
        if not o: o = I[k] = dict(names=collections.Counter(), types=collections.Counter(), ctry=collections.Counter(), e=0, x=0, o=0, tot=0, ld=None, h=set(), hp=0, hc=None, hcat=collections.Counter(), fl=set())
        o["names"][name.strip()] += 1
        return o
    for s in st:
        o = row(s["investor"])
        if not o: continue
        o["fl"].add("a" if s["source"] in ("nse_bulk", "nse_block") else "n")
        if s["investor_type"]: o["types"][s["investor_type"]] += 1
        if s["investor_country"]: o["ctry"][s["investor_country"]] += 1
        o["tot"] += 1; d = s["published_at"][:10]
        if not o["ld"] or d > o["ld"]: o["ld"] = d
        if d >= cut: o["e" if s["event_type"] == "entry" else "x" if s["event_type"] == "exit" else "o"] += 1
    latest = {}
    for r in shp:
        kk = (norm(r["company"]), norm(r["holder"]))
        if kk not in latest or r["period_end"] > latest[kk]["period_end"]: latest[kk] = r
    for r in latest.values():
        o = row(r["holder"])
        if not o: continue
        o["fl"].add("f"); o["h"].add(norm(r["company"])); o["hcat"][r["category"]] += 1
        if r["pct"] > o["hp"]: o["hp"], o["hc"] = r["pct"], r["company"]
    pn = {norm(p["holder"]) for p in prof if p.get("wikidata_id") or p.get("label")}
    rows = []
    for k, o in I.items():
        t = o["types"].most_common(1)[0][0] if o["types"] else ("fpi" if o["hcat"].most_common(1) and o["hcat"].most_common(1)[0][0] == "Foreign portfolio investor" else None)
        rows.append(dict(nk=k, n=o["names"].most_common(1)[0][0], t=t, c=(o["ctry"].most_common(1) or [[None]])[0][0], e=o["e"], x=o["x"], o=o["o"], tot=o["tot"], ld=o["ld"], h=len(o["h"]),
                         hp=o["hp"] or None, hc=o["hc"], fl="".join(sorted(o["fl"])), p=1 if k in pn else 0, al=len(o["names"]), ro=deal_quality.role(o["names"].most_common(1)[0][0])))
    rows.sort(key=lambda r: (r["ro"] != "foreign", -(r["e"] + r["x"] + r["o"]), -r["tot"], r["n"].lower()))
    if len(rows) < 800: raise BuildError(f"only {len(rows)} investor names")
    asof = max(s["published_at"][:10] for s in st)
    return "INV", dict(rows=rows, news_strings=len({s["investor"] for s in st}), shp_strings=len({r["holder"] for r in latest.values()}), cut=cut, asof=asof, built=built_stamp())
