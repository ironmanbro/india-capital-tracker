"""deals.js: every deal of the last 90 days (exchange deals grade A, news deals grade C) and the monthly ODI series (Deals page)."""
import collections, datetime as dt
from common import get, paged, stories, today, built_stamp, BuildError
import deal_quality

def build():
    T = today(); since = (T - dt.timedelta(days=90)).isoformat()
    rows = []
    for x in stories():
        if x["published_at"][:10] < since: continue
        ev, fk = x["event_type"], x["flow_kind"]
        if ev == "regulation" or not (fk == "capital" or ev == "fund_launch"): continue
        rows.append(dict(d=x["published_at"][:10], inv=x["investor"], it=x["investor_type"], ic=x["investor_country"], tgt=x["target"], usd=x["amount_usd_m"], stage=x["deal_stage"], ev=ev, n=x["reports"],
                         g="A" if x["source"] in ("nse_block", "nse_bulk") else "C", src=x["source_name"], t=x["title"]))
    fxr = get("fx_ref?select=rate&ccy=eq.USD&order=day.desc&limit=1"); fx = fxr[0]["rate"] if fxr else None
    for r in rows: deal_quality.apply(r, inr_per_usd=fx)
    rows.sort(key=lambda r: (r["d"], r["usd"] or 0), reverse=True)
    if len(rows) < 50: raise BuildError(f"only {len(rows)} deals in the last 90 days")
    if (T - dt.date.fromisoformat(rows[0]["d"])).days > 10: raise BuildError("newest deal is more than 10 days old: " + rows[0]["d"])
    odi_m = get("odi_monthly?select=month,equity,loan,guarantee,total,deals,released_on&order=month.desc&limit=8")
    if not odi_m: raise BuildError("no ODI months")
    latest = odi_m[0]["month"]
    cty = collections.defaultdict(lambda: [0, 0])
    for r in paged(f"odi_deals?select=country,total&month=eq.{latest}"):
        c = cty[r["country"]]; c[0] += r["total"] or 0; c[1] += 1
    odi_c = sorted(([k, round(v[0], 1), v[1]] for k, v in cty.items()), key=lambda x: -x[1])[:6]
    return "DEALS", dict(rows=rows, odi=odi_m[::-1], odi_ctry=odi_c, odi_month=latest, since=since, built=built_stamp())
