"""regs.js: SEBI and RBI rules since 2021 and the latest CCI merger orders, with a STRICT name match from a CCI order to a reported deal (Regulations page).
The match needs the whole cleaned name to be equal (or to start on a word boundary), a plausible date gap, and never uses exchange deals."""
import collections, datetime as dt, re
from common import paged, stories, today, built_stamp, BuildError

_SUF = r"\b(limited|ltd|llc|llp|lp|inc|plc|corp|corporation|pte|pvt|private|company|co|bv|b v|sa|ag|gmbh|sas|ii|iii)\b"
def _n(s):
    s = (s or "").replace("​", "").lower().replace("&", " and ")
    return re.sub(r"\s+", " ", re.sub(_SUF, " ", re.sub(r"[^a-z0-9 ]", " ", s))).strip()
def _dm(s):
    try: return dt.datetime.strptime(s, "%d/%m/%Y").date().isoformat()
    except (TypeError, ValueError): return None

def build():
    T = today()
    regs = paged("stories?select=published_at,source,regulator,doc_type,title,summary,issued_on,effective_on,instruments,url&event_type=eq.regulation&order=published_at.desc")
    if len(regs) < 100: raise BuildError(f"only {len(regs)} regulation rows")
    cci = []
    for x in paged("feed_records?select=key,data&dataset=eq.cci&order=as_of.desc"):
        d = x["data"]
        cci.append(dict(no=x["key"], form=d.get("form"), status=d.get("status") or "", parties=d.get("parties") or "", decided=_dm(d.get("decision_date")), notified=_dm(d.get("notification_date")),
                        link=(d.get("summary_links") or d.get("order_links") or [None])[0]))
    if len(cci) < 100: raise BuildError(f"only {len(cci)} CCI rows")
    names = collections.defaultdict(list)
    for s in stories():
        if s["source"] in ("nse_bulk", "nse_block"): continue
        for f in (s["investor"], s["target"]):
            n = _n(f)
            if len(n) >= 6 and " " in n or len(n) >= 9: names[n].append((s["published_at"][:10], s["investor"], s["target"], s["amount_usd_m"]))
    recent = [r for r in cci if r["decided"] and r["decided"] >= (T - dt.timedelta(days=365)).isoformat()]
    hit = {}
    for r in recent:
        parts = [p for p in (_n(p) for p in re.split(r"\band\b|;|,", r["parties"].replace("  ", " "))) if len(p) >= 6]
        for p in parts:
            for n, lst in names.items():
                if n == p or p.startswith(n + " ") or n.startswith(p + " "):
                    for d, inv, tgt, usd in lst:
                        gap = (dt.date.fromisoformat(r["notified"] or r["decided"]) - dt.date.fromisoformat(d)).days
                        if -30 <= gap <= 240 and r["no"] not in hit: hit[r["no"]] = dict(inv=inv, tgt=tgt, d=d, usd=usd)
    top = sorted((r for r in cci if r["decided"]), key=lambda r: r["decided"], reverse=True)[:60]
    out_cci = [dict(no=r["no"], f=r["form"], s=r["status"], p=re.sub(r"\s+", " ", r["parties"].replace("​", "")).strip(), dd=r["decided"], nd=r["notified"], l=r["link"], m=hit.get(r["no"])) for r in top]
    return "REGS", dict(regs=[dict(d=r["issued_on"] or r["published_at"][:10], reg=r["regulator"], dt=r["doc_type"], t=r["title"], s=r["summary"] or "", eff=r["effective_on"], ins=r["instruments"] or [], u=r["url"]) for r in regs],
                        cci=out_cci, cci_n12=len(recent), cci_m12=sum(1 for r in recent if r["no"] in hit), built=built_stamp())
