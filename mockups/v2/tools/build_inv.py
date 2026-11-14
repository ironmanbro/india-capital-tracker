#!/usr/bin/env python3
"""Builds mockups/v2/inv.js: one row per investor NAME (news, exchange deals, shareholding filings), keyed like the
database (norm_name). Names are NOT merged here beyond norm_name(); grouping comes from confirmed aliases at view time
(resolver.js), so the directory changes as the owner reviews. Usage: python3 tools/build_inv.py"""
import collections, datetime as dt, json, os, re, urllib.request
URL = os.environ.get("SUPABASE_URL", "https://urpphqybqmxlwhjghsmf.supabase.co") + "/rest/v1/"
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_zSo8W_FfT_fZEcfMWoumOw_Yv9mmVWB")
HERE = os.path.dirname(os.path.abspath(__file__))
CUT = (dt.date(2026, 11, 14) - dt.timedelta(days=365)).isoformat()
def get(p):
    return json.load(urllib.request.urlopen(urllib.request.Request(URL + p, headers={"apikey": KEY, "Authorization": "Bearer " + KEY}), timeout=120))
def paged(p, step=1000):
    out = []
    for off in range(0, 20000, step):
        part = get(f"{p}&limit={step}&offset={off}"); out += part
        if len(part) < step: break
    return out
DROP = r"\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b"   # = SQL norm_name()
def norm(t):
    t = re.sub(r"[^a-zA-Z0-9]+", " ", t or "").lower()
    return re.sub(r"\s+", " ", re.sub(DROP, " ", t)).strip()

stories = paged("stories?select=published_at,source,investor,investor_type,investor_country,event_type&investor=not.is.null&flow_kind=eq.capital&order=published_at.desc")
shp = paged("shareholdings?select=company,period_end,holder,category,pct&order=period_end.desc")
prof = paged("investor_profiles?select=holder,label,wikidata_id")
I = {}
def row(name):
    k = norm(name)
    if not k: return None
    o = I.get(k)
    if not o: o = I[k] = dict(k=k, names=collections.Counter(), types=collections.Counter(), ctry=collections.Counter(), e=0, x=0, o=0, uc=0.0, ua=0.0, tot=0, ld=None, h=set(), hp=0, hc=None, hcat=collections.Counter(), fl=set())
    o["names"][name.strip()] += 1
    return o
for s in stories:
    o = row(s["investor"])
    if not o: continue
    ex = s["source"] in ("nse_bulk", "nse_block"); o["fl"].add("a" if ex else "n")
    if s["investor_type"]: o["types"][s["investor_type"]] += 1
    if s["investor_country"]: o["ctry"][s["investor_country"]] += 1
    o["tot"] += 1; d = s["published_at"][:10]
    if not o["ld"] or d > o["ld"]: o["ld"] = d
    if d >= CUT:
        o["e" if s["event_type"] == "entry" else "x" if s["event_type"] == "exit" else "o"] += 1
latest = {}
for r in shp:
    kk = (norm(r["company"]), norm(r["holder"]))
    if kk not in latest or r["period_end"] > latest[kk]["period_end"]: latest[kk] = r
for r in latest.values():
    o = row(r["holder"])
    if not o: continue
    o["fl"].add("f"); o["h"].add(norm(r["company"])); o["hcat"][r["category"]] += 1
    if r["pct"] > o["hp"]: o["hp"], o["hc"] = r["pct"], r["company"]
PN = {norm(p["holder"]) for p in prof if p.get("wikidata_id") or p.get("label")}
rows = []
for k, o in I.items():
    t = o["types"].most_common(1)[0][0] if o["types"] else ("fpi" if o["hcat"].most_common(1) and o["hcat"].most_common(1)[0][0] == "Foreign portfolio investor" else None)
    rows.append(dict(nk=k, n=o["names"].most_common(1)[0][0], t=t, c=(o["ctry"].most_common(1) or [[None]])[0][0], e=o["e"], x=o["x"], o=o["o"], uc=round(o["uc"]), ua=round(o["ua"]),
                     tot=o["tot"], ld=o["ld"], h=len(o["h"]), hp=o["hp"] or None, hc=o["hc"], fl="".join(sorted(o["fl"])), p=1 if k in PN else 0, al=len(o["names"])))
rows.sort(key=lambda r: (-(r["e"] + r["x"] + r["o"]), -r["tot"], r["n"].lower()))
out = dict(rows=rows, news_strings=len({s["investor"] for s in stories}), shp_strings=len({r["holder"] for r in latest.values()}), cut=CUT, asof="2026-11-13",
           built=dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC"))
open(os.path.join(HERE, "..", "inv.js"), "w").write("window.INV=" + json.dumps(out, separators=(",", ":")) + ";")
both = sum(1 for r in rows if "f" in r["fl"] and ("n" in r["fl"] or "a" in r["fl"]))
print("rows", len(rows), "| news/exchange", sum(1 for r in rows if re.search("[na]", r["fl"])), "| filed", sum(1 for r in rows if "f" in r["fl"]), "| in both", both, "| active 12m", sum(1 for r in rows if r["e"] + r["x"] + r["o"]))
