"""reg.js: the NSDL FPI register with its watch lists, the IFSCA directory counts and the foreign-limit lists (Registrations page)."""
import collections
from common import get, paged, built_stamp, BuildError

def build():
    watch = get("rpc/fpi_watch", post={})
    for k in ("expiring", "late_fee", "new", "dropped", "invalid"):
        if k not in watch: raise BuildError("fpi_watch has no list " + k)
    reg = paged("fpi_registry?select=reg_no,name,country,category,sub_category,status,valid_upto,reg_year,registered_on&order=reg_no")
    if len(reg) < 10000: raise BuildError(f"only {len(reg)} register rows")
    stats = get("directory_stats?select=*")[0]
    cs = sorted({x["country"] or "" for x in reg}); ci = {c: i for i, c in enumerate(cs)}
    ss = sorted({x["sub_category"] or "" for x in reg}); si = {c: i for i, c in enumerate(ss)}
    stc = {"Registered": 0, "On Late Fee Window": 1, "Invalid": 2}
    rows = [[x["reg_no"], x["name"], ci[x["country"] or ""], 1 if x["category"] == "I" else 2, si[x["sub_category"] or ""], stc.get(x["status"], 0), x["valid_upto"], x["registered_on"], x["reg_year"]] for x in reg]
    lim = []
    for r in paged("fpi_limits?select=list,as_of,company,isin,raw"):
        raw = r["raw"]
        try: lim.append(dict(l=r["list"], co=r["company"], agg=float(raw.get("aggregate investment (%)")), cap=float(raw.get("aggregate permissible limit (%)")),
                             since=raw.get("date when red flag was activated") or raw.get("date when company was included in breach list"), as_of=r["as_of"]))
        except (TypeError, ValueError): pass
    cat = collections.defaultdict(int)
    for r in get("ifsca_type_counts?select=*&order=n.desc&limit=500"): cat[r["category"]] += r["n"]
    cc = [[c["country"], c["n"]] for c in get("fpi_country_counts?select=*&order=n.desc&limit=500")]
    return "REG", dict(rows=rows, countries=cs, subs=ss, watch={k: ([x["reg_no"] for x in v] if k != "dropped" else v) for k, v in watch.items()}, stats=stats, cc=cc,
                       ifsca=sorted(cat.items(), key=lambda kv: -kv[1]), lim=lim, built=built_stamp())
