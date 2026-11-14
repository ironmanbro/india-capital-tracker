"""data.js: flows, FX, reserves, debt limits, foreign limits, exchange deals of the latest day, sector table, calendar (Home and Flows pages)."""
import collections, datetime as dt, re
from common import get, paged, stories, today, built_stamp, BuildError

def build():
    T = today(); out = {}
    # --- NSDL daily flows, last 120 days; the segment rows must add up to the total
    since = (T - dt.timedelta(days=120)).isoformat()
    days = {}
    for r in paged(f"fpi_flows?select=day,segment,route,net_cr,net_usd_m&route=in.(Sub-total,Total)&day=gte.{since}&order=day.asc"):
        days.setdefault(r["day"], {})[r["segment"]] = (r["net_cr"], r["net_usd_m"])
    rows = []
    for day in sorted(days):
        s = days[day]; g = lambda k: (s.get(k) or (0, 0))
        tot = g("Total"); debt = sum(g(k)[0] for k in ("Debt-General Limit", "Debt-VRR", "Debt-FAR"))
        parts = g("Equity")[0] + debt + g("Hybrid")[0] + g("Mutual Funds")[0] + g("AIFs")[0]
        rows.append(dict(d=day, total=tot[0], usd=tot[1], eq=g("Equity")[0], debt=round(debt, 2), hyb=g("Hybrid")[0], mf=g("Mutual Funds")[0], aif=g("AIFs")[0], chk=round(tot[0] - parts, 1)))
    if len(rows) < 5: raise BuildError("fewer than 5 daily NSDL rows")
    if (T - dt.date.fromisoformat(rows[-1]["d"])).days > 10: raise BuildError("NSDL daily flows are more than 10 days old: " + rows[-1]["d"])
    out["nsdl_daily"] = rows
    out["nsdl_monthly"] = [[m["month"][:7], m["net_cr"]] for m in paged("fpi_monthly?select=month,segment,net_cr&segment=eq.Total&order=month.asc")]
    if len(out["nsdl_monthly"]) < 12: raise BuildError("NSDL monthly table is too short")
    # --- NSE provisional FII/DII
    fd = {}
    for x in paged("feed_records?select=data&dataset=eq.fii_dii"):
        d = x["data"]; t = dt.datetime.strptime(d["date"], "%d-%b-%Y").date().isoformat()
        fd.setdefault(t, {})["fii" if d["category"].startswith("FII") else "dii"] = dict(buy=float(d["buyValue"]), sell=float(d["sellValue"]), net=float(d["netValue"]))
    out["nse_fiidii"] = [dict(d=k, **v) for k, v in sorted(fd.items())]
    # --- FX (FBIL) and reserves (RBI)
    fx = get("fx_ref?select=day,ccy,rate&ccy=eq.USD&order=day.desc&limit=130")
    out["fbil_usd"] = [[r["day"], r["rate"]] for r in sorted(fx, key=lambda r: r["day"])]
    res = get("fx_reserves?select=*&order=week.desc&limit=30")
    out["reserves"] = [dict(w=r["week"], usd=r["total_usd_m"], chg=r["wk_change_usd_m"], fca=r["fca_usd_m"], gold=r["gold_usd_m"]) for r in sorted(res, key=lambda r: r["week"])]
    if not out["fbil_usd"] or not out["reserves"]: raise BuildError("no FX or reserves rows")
    # --- debt limits (NSDL corporate bonds, CCIL G-sec and SDL) and FAR holdings
    out["debt_util"] = [dict(name=x["key"], pct=x["data"]["% of Limits Utilised_(E)"], vrr=x["data"]["Investment_VRR_(INR Cr)_(C)"], gen=x["data"]["Investment_General Route_(INR Cr)_(B)"],
                             tot=x["data"]["Total Investment_(INR Cr)_(D)=(B)+(C)"], avail=x["data"]["Limit Available for Investment_(INR Cr)_(F)"], lim=x["data"]["Upper Limit (Refer to Note 1 &2)_(INR Cr)_(A)"])
                        for x in paged("feed_records?select=key,data&dataset=eq.fpi_debt_summary") if x["key"] != "Total"]
    cc = get("ccil_fpi?select=day,limits&order=day.desc&limit=1")[0]
    out["ccil_day"] = cc["day"]
    out["ccil_limits"] = [dict(route=l["route"], ins=l["instrument"], lim=l["limit_cr"], inv=l["invested_cr"], vrr=l["vrr_cr"], pct=l["used_pct"]) for l in cc["limits"]]
    far = [x["data"] for x in paged("feed_records?select=data&dataset=eq.fpi_far_gsec") if x["data"].get("Sec Holdings (%)") is not None]
    far.sort(key=lambda d: -d["Indicative Value Of Aggregate Holding Of FPIS (INR CR#)"])
    out["far"] = [dict(sec=d["Security Description"], isin=d["ISIN"], pct=d["Sec Holdings (%)"], cr=d["Indicative Value Of Aggregate Holding Of FPIS (INR CR#)"], out=d["Outstanding Position Of Govt# Securities (INR CR#)"]) for d in far[:8]]
    if not out["ccil_limits"] or not out["far"]: raise BuildError("no CCIL limits or FAR holdings")
    # --- foreign investment limit lists (NSDL)
    rf = []
    for r in paged("fpi_limits?select=list,as_of,company,isin,raw"):
        raw = r["raw"]
        try: agg = float(raw.get("aggregate investment (%)")); cap = float(raw.get("aggregate permissible limit (%)"))
        except (TypeError, ValueError): continue
        rf.append(dict(list=r["list"], asof=r["as_of"], co=r["company"], isin=r["isin"], agg=agg, cap=cap, since=raw.get("date when red flag was activated") or raw.get("date when company was included in breach list"),
                       exch=raw.get("listed on stock exchange*"), room=raw.get("available investment headroom (in terms of quantity)")))
    out["limits"] = rf
    # --- exchange bulk and block deals of the latest day (from the exchange files), duplicates between the two files removed
    nse = [s for s in stories() if s["source"] in ("nse_bulk", "nse_block")]
    day = max(s["published_at"][:10] for s in nse)
    key = dt.date.fromisoformat(day).strftime("%d-%b-%Y")
    dl, seen = [], set()
    # the same trade can sit in both the block and the bulk file: read the block file first so it is labelled BLOCK
    for x in sorted(paged(f"feed_records?select=key,data&dataset=eq.nse_deals&key=ilike.*|{key}|*"), key=lambda x: (not x["key"].startswith("BLOCK"), x["key"])):
        d = x["data"]
        if not d.get("watp") or not d.get("qty"): continue
        try: v = float(d["qty"]) * float(d["watp"]) / 1e7
        except (TypeError, ValueError): continue
        k = (d["symbol"], (d["clientName"] or "").strip(), d["buySell"], int(float(d["qty"])))
        if k in seen: continue
        seen.add(k)
        dl.append(dict(d=day, kind="BLOCK" if x["key"].startswith("BLOCK") else "BULK", sym=d["symbol"], name=d["name"].strip(), client=(d["clientName"] or "").strip(), side=d["buySell"], qty=int(float(d["qty"])), px=float(d["watp"]), cr=round(v, 1)))
    out["deals_latest"] = sorted(dl, key=lambda x: -x["cr"])[:10]; out["deals_date"] = day
    if not out["deals_latest"]: raise BuildError("no exchange deals for " + key)
    # --- reported deals (news only; exchange rows are shown separately)
    news = [s for s in stories() if s["flow_kind"] == "capital" and s["source"] not in ("nse_bulk", "nse_block")][:12]
    out["reported"] = [dict(t=r["published_at"][:10], src=r["source_name"], title=r["title"], inv=r["investor"], ctry=r["investor_country"], tgt=r["target"], usd=r["amount_usd_m"], stage=r["deal_stage"], n=r["reports"]) for r in news]
    # --- sector table: the two newest fortnights and the latest assets under custody, found from the column names (they change every fortnight)
    sec = paged("feed_records?select=data&dataset=eq.fpi_sector")
    if not sec: raise BuildError("no sector rows")
    cols = sec[0]["data"].keys()
    auc_re = re.compile(r"^AUC as on (\w+ \d+), (\d{4})_IN INR Cr\._Total$"); net_re = re.compile(r"^Net Investment (\w+ \d+-\d+), (\d{4})_IN INR Cr\._Total$")
    def when(txt, year, last=False):
        mon, rest = txt.split(" ", 1); day = rest.split("-")[-1] if last else rest.split("-")[0]
        return dt.datetime.strptime(f"{mon} {day} {year}", "%B %d %Y").date()
    aucs = sorted((when(m.group(1), m.group(2)), c) for c in cols for m in [auc_re.match(c)] if m)
    nets = sorted((when(m.group(1), m.group(2)), m.group(1), c) for c in cols for m in [net_re.match(c)] if m)
    if not aucs or len(nets) < 2: raise BuildError("sector columns not recognised")
    auc_date, auc_col = aucs[-1]; periods = nets[-2:]
    srows = []
    for x in sec:
        d = x["data"]
        def num(c):
            v = d.get(c); return float(v) if v not in (None, "") else None
        srows.append(dict(name=d["Sectors"], auc=num(auc_col), nets={p[1]: num(p[2]) for p in periods}))
    out["sector_total"] = next(x for x in srows if x["name"] == "Grand Total")
    out["sector"] = sorted((x for x in srows if x["name"] != "Grand Total"), key=lambda s: -(s["auc"] or 0))
    out["sector_meta"] = dict(auc_date=auc_date.isoformat(), periods=[dict(key=p[1], start=when(p[1], p[0].year).isoformat(), end=p[0].isoformat()) for p in periods])
    # --- calendar
    out["holidays"] = [dict(d=h["day"], desc=h["description"], seg=h["segment"]) for h in get(f"mkt_holidays?select=*&day=gte.{T.isoformat()}&order=day.asc&limit=60") if h["segment"] in ("CM", "CBM", "CD")]
    out["index_events"] = get("index_events?select=day,provider,index_name,event,est_flow_usd_m&order=day.desc&limit=5")
    out["renewals"] = [dict(reg=r["reg_no"], name=r["name"], ctry=r["country"], cat=r["category"], valid=r["valid_upto"]) for r in get(f"fpi_registry?select=reg_no,name,country,category,sub_category,valid_upto&valid_upto=gte.{T.isoformat()}&order=valid_upto.asc&limit=8")]
    out["built"] = built_stamp()
    return "ICT", out
