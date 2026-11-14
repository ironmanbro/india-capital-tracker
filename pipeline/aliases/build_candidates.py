#!/usr/bin/env python3
"""Propose groups of names that may be the same investor (or its funds and vehicles).

Reads the public tables (stories, shareholdings, fpi_registry, CCI orders) with the read-only key, normalises every
name the same way as the database function norm_name(), and proposes groups. It writes JSON only. Nothing is
confirmed here: every proposal waits for the owner's decision in the review queue.

Rules, in order:
  1. exact   names equal after norm_name() are one entity written several ways          (relation: same)
  2. curated patterns in aliases_curated.json                                           (relation as written)
  3. prefix  a name that starts, on a word boundary, with the name of an investor seen in news
             (for example "GOLDMAN SACHS BANK EUROPE SE" starts with "Goldman Sachs")   (fund_of or related)
Generic words are never used as the start of a name (STOP below).

Usage: python3 build_candidates.py [--out candidates.json] [--ui ../../mockups/v2/alias.js] [--top 150]   (the UI file holds every member of each group)
Environment: SUPABASE_URL and SUPABASE_KEY (read-only key) override the defaults below.
"""
import argparse, collections, datetime as dt, json, os, re, urllib.request

URL = os.environ.get("SUPABASE_URL", "https://urpphqybqmxlwhjghsmf.supabase.co") + "/rest/v1/"
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_zSo8W_FfT_fZEcfMWoumOw_Yv9mmVWB")
HERE = os.path.dirname(os.path.abspath(__file__))
TODAY = dt.date(2026, 11, 14)  # date of the data snapshot; replace with date.today() in production
CUT12 = (TODAY - dt.timedelta(days=365)).isoformat()

def get(path):
    req = urllib.request.Request(URL + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    return json.load(urllib.request.urlopen(req, timeout=120))

def paged(path, step=1000, cap=20000):
    out = []
    for off in range(0, cap, step):
        part = get(f"{path}&limit={step}&offset={off}")
        out += part
        if len(part) < step:
            break
    return out

# Same words as the SQL function norm_name() in supabase/migrations/20261029_investor_profiles.sql
DROP = r"\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b"
def norm(t):
    t = re.sub(r"[^a-z0-9]+", " ", (t or "").replace("​", "").lower())
    return re.sub(r"\s+", " ", re.sub(DROP, " ", t)).strip()

# Words too generic to start a group on their own, and phrases that name many unrelated bodies.
STOP = set("""india indian global capital asia international national first united group holdings investments investment
partners bank new general american european pacific government ventures finance financial securities services
technologies industries energy power sovereign pension insurance life asset assets management india's emerging markets
equity mutual state central public private strategic opportunities growth income""".split())
STOP_PHRASES = {"government of india", "state bank", "life insurance", "reserve bank"}
# Wording that shows the first name is a custodian, trustee or agent: the fund named after it may belong to someone else.
CUSTODIAN = re.compile(r"\b(re:|as trustee|on behalf of|as depositary|as custodian|as nominee|for the benefit of|a/c|acting as|custody bank)\b", re.I)
# Words that only change the legal form, so "X Private Limited" is the same body as "X".
LEGAL_ONLY = {"private", "pvt", "incorporated", "gmbh", "spa", "srl", "ab", "as", "oy", "pcc", "company", "corporation", "holdings", "holding", "group"}
FUNDISH = re.compile(r"\b(fund|funds|trust|sicav|etf|portfolio|index|series|master|pool|plc|ucits|investors|investment)\b", re.I)

def party_names(s):
    s = (s or "").replace("​", " ")
    parts = re.split(r"\s+and\s+|;|\d\.\s+", s)
    return [re.sub(r"\s+", " ", p).strip(" ,.") for p in parts if len(p.strip(" ,.")) >= 4]

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "candidates.json"))
    ap.add_argument("--ui", default="")
    ap.add_argument("--top", type=int, default=150)
    a = ap.parse_args()
    curated = json.load(open(os.path.join(HERE, "aliases_curated.json")))["patterns"]
    for p in curated: p["re"] = re.compile(p["regex"], re.I)

    print("fetching ...")
    stories = paged("stories?select=published_at,source,investor,investor_type,investor_country,target,event_type,title&investor=not.is.null&flow_kind=eq.capital&order=published_at.desc")
    shp = paged("shareholdings?select=company,period_end,holder,pct&order=period_end.desc")
    fpi = paged("fpi_registry?select=reg_no,name,country,category&order=reg_no")
    cci = paged("feed_records?select=data&dataset=eq.cci&order=as_of.desc")
    print(f"  stories {len(stories)}, shareholdings {len(shp)}, fpi_registry {len(fpi)}, cci {len(cci)}")

    E = {}  # key -> entity
    def ent(name):
        k = norm(name)
        if not k: return None
        e = E.get(k)
        if e is None:
            e = E[k] = dict(key=k, spell=collections.Counter(), src=collections.Counter(), news=0, deals12=0, e12=0, x12=0,
                            deals_all=0, type=collections.Counter(), ctry=collections.Counter(), shp=set(), shp_max=(0, None),
                            fpi=[], cci=0, exch=0, last=None)
        e["spell"][name.strip()] += 1
        return e

    for s in stories:
        e = ent(s["investor"])
        if not e: continue
        d = s["published_at"][:10]
        is_ex = s["source"] in ("nse_bulk", "nse_block")
        e["src"]["stories"] += 1; e["deals_all"] += 1
        if is_ex: e["exch"] += 1
        else: e["news"] += 1
        if s["investor_type"]: e["type"][s["investor_type"]] += 1
        if s["investor_country"]: e["ctry"][s["investor_country"]] += 1
        if not e["last"] or d > e["last"]: e["last"] = d
        if d >= CUT12:
            e["deals12"] += 1
            if s["event_type"] == "entry": e["e12"] += 1
            elif s["event_type"] == "exit": e["x12"] += 1
    latest = {}
    for r in shp:
        kk = (norm(r["company"]), norm(r["holder"]))
        if kk not in latest or r["period_end"] > latest[kk]["period_end"]: latest[kk] = r
    for r in latest.values():
        e = ent(r["holder"])
        if not e: continue
        e["src"]["shareholdings"] += 1; e["shp"].add(norm(r["company"]))
        if r["pct"] > e["shp_max"][0]: e["shp_max"] = (r["pct"], r["company"])
    for r in fpi:
        e = ent(r["name"])
        if e: e["src"]["fpi_registry"] += 1; e["fpi"].append((r["reg_no"], r["country"], r["category"]))
    seen = set()
    for c in cci:
        for p in party_names(c["data"].get("parties")):
            e = ent(p)
            if e and (e["key"], c["data"].get("combination_no")) not in seen:
                seen.add((e["key"], c["data"].get("combination_no"))); e["src"]["cci"] += 1; e["cci"] += 1
    print(f"  distinct names after norm_name(): {len(E)}")
    COUNTRIES = {norm(r["country"]) for r in fpi if r.get("country")} | {"uae", "usa", "uk", "us"}

    # anchors: investors written up in news, with a distinctive start
    def usable(k, e):
        toks = k.split()
        if not toks or k in STOP_PHRASES or k in COUNTRIES: return False
        if len(toks) == 1: return toks[0] not in STOP and (len(k) >= 5 or e["news"] >= 2)
        return not all(t in STOP for t in toks)
    anchors = {k for k, e in E.items() if e["news"] >= 1 and usable(k, e)}

    parent, rule, rel = {}, {}, {}
    acro = {}
    for a_ in anchors:
        t_ = a_.split()
        if len(t_) >= 3:
            ini = "".join(w[0] for w in t_)
            if 4 <= len(ini) <= 6 and ini in anchors and ini != a_: acro[ini] = a_
    for k, e in E.items():
        disp = e["spell"].most_common(1)[0][0]
        hit = next((p for p in curated if p["re"].search(disp)), None)
        if hit:
            parent[k] = "curated:" + hit["group"]; rule[k] = "curated pattern " + hit["regex"]; rel[k] = hit["relation"]; continue
        if k in acro:
            parent[k] = acro[k]; rule[k] = f'initials of "{acro[k]}"'; rel[k] = "same"; continue
        cands = [a for a in anchors if a != k and k.startswith(a + " ")]
        if cands:
            top = max(cands, key=len)
            parent[k] = top
            fund = bool(FUNDISH.search(disp))
            rest = k[len(top):].split()
            rule[k] = f'starts with "{top}"'
            rel[k] = "same" if rest and all(w in LEGAL_ONLY for w in rest) else ("fund_of" if fund else "related")
            if CUSTODIAN.search(disp): rel[k] = "held_via"
    def root(k):
        seen = set()
        while k in parent and not parent[k].startswith("curated:") and k not in seen:
            seen.add(k); k = parent[k]
        return parent.get(k, k) if k in parent and parent[k].startswith("curated:") else k
    groups = collections.defaultdict(list)
    for k in E: groups[root(k)].append(k)

    def disp(k): return E[k]["spell"].most_common(1)[0][0]
    clusters = []
    for r, ks in groups.items():
        if len(ks) < 2:  # one entity (spelling variants are already merged by norm_name): nothing to review
            continue
        canon = r.split(":", 1)[1] if r.startswith("curated:") else disp(r)
        mem = []
        for k in ks:
            e = E[k]
            relation = "same" if k == r else rel.get(k, "same")  # root is the group's own name
            rl = "root" if k == r else rule.get(k, "")
            conf = "high" if (k == r or relation == "same") else ("medium" if len(parent.get(k, "").split()) >= 2 or relation == "fund_of" else "low")
            if rl.startswith("curated") or rl.startswith("initials"): conf = "medium"
            warn = None
            if relation == "held_via":
                conf, warn = "low", "Custodian or trustee wording: the fund named may belong to another manager"
            if relation == "same" and rl.startswith("starts with"): conf = "high"
            mem.append(dict(warn=warn, name=disp(k), key=k, spellings=[s for s, _ in e["spell"].most_common(4)], relation=relation, rule=rl, conf=conf,
                            stories=e["src"]["stories"], exch=e["exch"], news=e["news"], shp=len(e["shp"]), shp_max=e["shp_max"][0] or None,
                            shp_co=e["shp_max"][1], fpi=len(e["fpi"]), fpi_ex=e["fpi"][:1], cci=e["cci"], d12=e["deals12"], e12=e["e12"], x12=e["x12"],
                            type=(e["type"].most_common(1) or [[None]])[0][0], ctry=(e["ctry"].most_common(1) or [[None]])[0][0]))
        mem.sort(key=lambda m: (m["name"] != canon, -m["d12"], -m["shp"], -m["fpi"], m["name"].lower()))
        tot = lambda f: sum(m[f] for m in mem)
        srcs = {s for m in mem for s, f in (("stories", m["stories"]), ("shareholdings", m["shp"]), ("fpi_registry", m["fpi"]), ("cci", m["cci"])) if f}
        bridge = ("stories" in srcs) and bool(srcs & {"shareholdings", "fpi_registry"})
        score = tot("d12") * 2 + tot("shp") + tot("fpi") * 0.5 + tot("cci") + (10 if bridge else 0)
        clusters.append(dict(id=re.sub(r"[^a-z0-9]+", "-", canon.lower()).strip("-")[:60], canon=canon, kind="investor", members=mem, names=len(mem),
                             d12=tot("d12"), shp=tot("shp"), fpi=tot("fpi"), cci=tot("cci"), news=tot("news"), exch=tot("exch"),
                             bridge=bridge, score=round(score, 1), srcs=sorted(srcs)))
    clusters.sort(key=lambda c: -c["score"])

    # headline numbers
    def has(keys, s): return any(E[k]["src"][s] for k in keys)
    news_keys = [k for k, e in E.items() if e["news"] or e["exch"]]
    filed_keys = [k for k, e in E.items() if e["src"]["shareholdings"]]
    exact_both = sum(1 for k in news_keys if E[k]["src"]["shareholdings"])
    grouped_both = sum(1 for k in news_keys if any(has(groups[root(k)], "shareholdings") for _ in [0]))
    stats = dict(built=dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC"), snapshot=TODAY.isoformat(),
                 names=len(E), anchors=len(anchors), clusters=len(clusters), members_in_clusters=sum(c["names"] for c in clusters),
                 by_source={s: sum(1 for e in E.values() if e["src"][s]) for s in ("stories", "shareholdings", "fpi_registry", "cci")},
                 news_names=len(news_keys), filed_names=len(filed_keys),
                 news_also_filed_exact=exact_both, news_also_filed_if_all_accepted=grouped_both,
                 news_also_registered_exact=sum(1 for k in news_keys if E[k]["src"]["fpi_registry"]),
                 news_also_registered_if_all_accepted=sum(1 for k in news_keys if has(groups[root(k)], "fpi_registry")),
                 relation=collections.Counter(m["relation"] for c in clusters for m in c["members"]), confidence=collections.Counter(m["conf"] for c in clusters for m in c["members"]),
                 bridging=sum(1 for c in clusters if c["bridge"]),
                 entities_with_several_spellings=sum(1 for e in E.values() if len(e["spell"]) > 1),
                 spellings_merged_by_norm_name=sum(len(e["spell"]) - 1 for e in E.values() if len(e["spell"]) > 1))
    json.dump(dict(stats=stats, clusters=clusters), open(a.out, "w"), ensure_ascii=False, indent=1)
    print(json.dumps(stats, indent=1, default=dict))
    if a.ui:
        top = clusters[:a.top]
        open(a.ui, "w", encoding="utf-8").write("window.ALIAS=" + json.dumps(dict(stats=stats, clusters=top), ensure_ascii=False, separators=(",", ":"), default=dict) + ";")
        print("ui file", a.ui, len(open(a.ui, encoding="utf-8").read()) // 1024, "KB")

if __name__ == "__main__":
    main()
