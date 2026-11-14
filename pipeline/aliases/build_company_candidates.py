#!/usr/bin/env python3
"""Link company names to listed companies, and propose the links that are not certain.

Listed companies have identifiers, so this is stricter than the investor generator:
  certain   Same NSE symbol or ISIN in any table (shareholding feed, corporate actions, deals, announcements, limits).
            These rows are one company by construction; nothing to review.
  exact     A free-text name (news target, CCI party, ODI Indian party) equals ONE registered name after cleaning.
  proposed  The text is the start of ONE registered name ("Lenskart" -> "Lenskart Solutions Limited"), or a registered
            name is the start of the text ("Tata Steel overseas arm" -> "Tata Steel"). Reviewed by the owner.
  ambiguous The text fits several registered names ("Tata", "Adani"). Listed in the output, never proposed.
Nothing is confirmed here.

Usage: python3 build_company_candidates.py [--out candidates_company.json] [--ui ../../mockups/v2/company_alias.js] [--top 150]
Environment: SUPABASE_URL and SUPABASE_KEY (read-only) override the defaults.
"""
import argparse, collections, datetime as dt, json, os, re, urllib.request

URL = os.environ.get("SUPABASE_URL", "https://urpphqybqmxlwhjghsmf.supabase.co") + "/rest/v1/"
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_zSo8W_FfT_fZEcfMWoumOw_Yv9mmVWB")
HERE = os.path.dirname(os.path.abspath(__file__))
TODAY = dt.date(2026, 11, 14)
CUT12 = (TODAY - dt.timedelta(days=365)).isoformat()

def get(path):
    return json.load(urllib.request.urlopen(urllib.request.Request(URL + path, headers={"apikey": KEY, "Authorization": "Bearer " + KEY}), timeout=180))
def paged(path, step=1000, cap=60000):
    out = []
    for off in range(0, cap, step):
        part = get(f"{path}&limit={step}&offset={off}"); out += part
        if len(part) < step: break
    return out

# Same words as the SQL function norm_name()
DROP = r"\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b"
def norm(t):
    t = re.sub(r"[^a-z0-9]+", " ", (t or "").replace("​", "").lower().replace("&", " and "))
    return re.sub(r"\s+", " ", re.sub(DROP, " ", t)).strip()
# For matching only (never stored): drop address, brackets, legal wording (typos too), and say whether the text names a PART
import difflib
PART = {"unit", "units", "arm", "subsidiary", "business", "plant", "plants", "stake", "assets", "division", "platform", "operations", "entity"}
EVENT = {"ipo", "fpo", "ofs"}                       # "HDB Financial Services IPO" is still the company
LEGAL_WORDS = ("limited", "ltd", "private", "pvt", "public", "company", "corporation", "corp", "incorporated", "inc")
def legal_like(tok):
    return any(tok == w or (len(tok) >= 4 and difflib.SequenceMatcher(None, tok, w).ratio() >= 0.8) for w in LEGAL_WORDS)
# Wording that makes a text a COMPLETE name of some body (a company with its legal form, or a fund/trust), so a longer
# registered name that merely starts with it is a different body.
LEGAL_RE = re.compile(r"\b(limited|ltd\.?|pvt\.?|private|llp|llc|inc\.?|corp\.?|corporation|plc|pte\.?|gmbh|ag|bv|co\.|fund|funds|trust|etf|scheme|portfolio)(?=\W|$)", re.I)
def has_legal(t):
    return bool(LEGAL_RE.search(t or ""))
def match_key(t):
    t = (t or "").replace("\u200b", " ")
    t = re.sub(r"^\s*(\(?[ivx0-9]+[\).]\s+)", "", t)               # "(iii) Sona BLW ..." or "1. FAL ..."
    t = re.sub(r"^\s*m/s\.?\s+", "", t, flags=re.I)
    head = t.split(",")[0]
    if len(head.split()) >= 2: t = head                                  # "Varun Beverages Limited, Gurugram" -> company
    t = re.sub(r"\(\s*(india|ind|i)\s*\)", " india ", t, flags=re.I)
    t = re.sub(r"\([^)]*\)", " ", t)
    t = re.sub(r"\b(trust|trusts|fund|funds|lp|etf)\b", lambda m_: m_.group(1).lower() + "x", t, flags=re.I)   # norm() would drop these
    k = norm(t).split()
    part = False
    while k and (k[-1] in PART or k[-1] in EVENT or legal_like(k[-1]) or k[-1] in ("and",)):
        if k[-1] in PART: part = True
        k.pop()
    return " ".join(k), part

ISIN_RE = re.compile(r"^IN[A-Z0-9]{10}$")
def clean_isin(x):
    x = (x or "").strip().upper()
    return x if ISIN_RE.match(x) else None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(HERE, "candidates_company.json"))
    ap.add_argument("--ui", default=""); ap.add_argument("--top", type=int, default=150)
    a = ap.parse_args()
    print("fetching ...")
    sh_feed = paged("feed_records?select=key,data&dataset=eq.nse_shareholding&order=key")
    deals_feed = paged("feed_records?select=data&dataset=eq.nse_deals&order=key")
    ann = get("feed_records?select=data&dataset=eq.extra&key=eq.nse_announcements") if False else []
    corp = paged("corp_actions?select=symbol,company,isin&order=ex_date")
    lim = paged("fpi_limits?select=company,isin,list")
    shp = paged("shareholdings?select=company,symbol,period_end,pct,holder&order=period_end.desc")
    stories = paged("stories?select=published_at,source,target,investor,event_type&target=not.is.null&order=published_at.desc")
    cci = paged("feed_records?select=data&dataset=eq.cci&order=as_of.desc")
    odi = paged("odi_deals?select=indian_party,is_individual,total,month&is_individual=eq.false&order=month.desc")
    print(f"  nse_shareholding {len(sh_feed)}, nse_deals {len(deals_feed)}, corp_actions {len(corp)}, fpi_limits {len(lim)}, shareholdings {len(shp)}, stories {len(stories)}, cci {len(cci)}, odi {len(odi)}")

    # ---- registry: union symbols and ISINs that appear together ----
    par = {}
    def find(x):
        par.setdefault(x, x)
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    def union(x, y): par[find(x)] = find(y)
    rows = []  # (isin, symbol, name, source)
    for r in sh_feed:
        d = r["data"]; rows.append((d.get("isin") or r["key"], (d.get("symbol") or "").strip(), d.get("name"), "nse_shareholding"))
    for r in corp: rows.append((r.get("isin"), (r.get("symbol") or "").strip(), r.get("company"), "corp_actions"))
    for r in lim: rows.append((r.get("isin"), "", r.get("company"), "fpi_limits"))
    for r in shp: rows.append((None, (r.get("symbol") or "").strip(), r.get("company"), "shareholdings"))
    for r in deals_feed:
        d = r["data"]
        if d.get("symbol"): rows.append((None, d["symbol"].strip(), d.get("name"), "nse_deals"))
    rows = [(clean_isin(i), s_, n_, src_) for i, s_, n_, src_ in rows]
    for isin, sym, name, src in rows:
        ns = ["i:" + isin] if isin else []
        if sym: ns.append("s:" + sym)
        for n in ns: find(n)
        for n in ns[1:]: union(ns[0], n)
    # NSE lists a rights entitlement (-RE) or partly paid share (-PP) under its own symbol: same issuer as the base symbol
    all_syms = {sym for _, sym, _, _ in rows if sym}
    for sym in all_syms:
        m_ = re.match(r"^(.+)-(RE|PP)$", sym)
        if m_ and m_.group(1) in all_syms: union("s:" + sym, "s:" + m_.group(1))
    comp = collections.defaultdict(lambda: dict(isins=set(), symbols=set(), names=collections.Counter(), official=collections.Counter(), src=collections.Counter(), current=set()))
    for isin, sym, name, src in rows:
        ns = ["i:" + isin] if isin else []
        if sym: ns.append("s:" + sym)
        if not ns or not name: continue
        c = comp[find(ns[0])]
        if isin: c["isins"].add(isin)
        if sym: c["symbols"].add(sym)
        c["names"][name.strip()] += 1; c["src"][src] += 1
        if src == "nse_shareholding":
            c["official"][name.strip()] += 1
            if isin: c.setdefault("current", set()).add(isin)
    ents = {}
    for rootk, c in comp.items():
        canon = (c["official"] or c["names"]).most_common(1)[0][0]
        ents[rootk] = dict(id=re.sub(r"[^a-z0-9]+", "-", (sorted(c["symbols"]) or sorted(c["isins"]) or ["x"])[0].lower()).strip("-"), canon=canon,
                           isins=sorted(c["isins"]), symbols=sorted(c["symbols"]), spell=[n for n, _ in c["names"].most_common(8)], src=dict(c["src"]),
                           current_isin=(sorted(c["current"]) or sorted(c["isins"]) or [None])[0],
                           keys={match_key(n)[0] for n in c["names"] if match_key(n)[0]}, conflict=len(c["symbols"]) > 1, isin_changed=len(c["isins"]) > 1)
    byname = collections.defaultdict(set)         # normalised name -> entity roots
    for r, e in ents.items():
        for k in e["keys"]: byname[k].add(r)
    print(f"  listed companies (by symbol/ISIN): {len(ents)}; more than one ISIN (share split etc., normal): {sum(1 for e in ents.values() if e['isin_changed'])}; more than one symbol (check): {sum(1 for e in ents.values() if e['conflict'])}")

    # ---- free-text names from sources that carry no identifier ----
    texts = collections.defaultdict(lambda: dict(stories=0, s12=0, exch=0, cci=0, odi=0, odi_usd=0.0, last=None, raw=collections.Counter(), legal=False))
    def add(t, src, d=None, usd=0.0, exch=False):
        t = (t or "").strip()
        if len(t) < 3: return
        k, part = match_key(t)
        if not k: return
        x = texts[(k, part)]; x["raw"][t] += 1; x["legal"] = x["legal"] or has_legal(t)
        if src == "stories":
            x["stories"] += 1
            if exch: x["exch"] += 1
            if d and d >= CUT12: x["s12"] += 1
            if d and (not x["last"] or d > x["last"]): x["last"] = d
        elif src == "cci": x["cci"] += 1
        elif src == "odi": x["odi"] += 1; x["odi_usd"] += usd or 0
    for s in stories:
        for piece in re.split(r"\s*;\s*", s["target"] or ""):
            add(piece, "stories", s["published_at"][:10], exch=s["source"] in ("nse_bulk", "nse_block"))
    seen = set()
    for c in cci:
        for p in re.split(r"\s+and\s+|;|\d\.\s+", (c["data"].get("parties") or "").replace("​", " ")):
            p = re.sub(r"\s+", " ", p).strip(" ,.")
            if len(p) >= 4 and (p, c["data"].get("combination_no")) not in seen: seen.add((p, c["data"].get("combination_no"))); add(p, "cci")
    for o in odi: add(o["indian_party"], "odi", usd=o["total"])
    print(f"  distinct free-text company names after cleaning: {len(texts)}")

    investor_keys = {norm(s_["investor"]) for s_ in stories if s_.get("investor")}
    # ---- match each text to the registry ----
    res = collections.Counter(); links = []      # (entity root, text-entry, rule, conf, relation)
    ambiguous = []
    names_sorted = sorted(byname)                # prefix search
    import bisect
    def prefix_hits(k):
        i = bisect.bisect_left(names_sorted, k + " "); hits = set()
        while i < len(names_sorted) and names_sorted[i].startswith(k + " "):
            hits |= byname[names_sorted[i]]; i += 1
        return hits
    GENERIC = {"india", "indian", "bharat", "global", "national", "new", "first", "general", "united", "state", "power", "tata", "adani", "reliance", "birla", "mahindra", "bajaj", "hdfc", "icici", "sbi", "kotak"}
    for (k, part), x in texts.items():
        toks = k.split()
        if k in byname:
            ents_ = byname[k]
            if len(ents_) == 1:
                r_ = next(iter(ents_))
                if part:
                    lasts = {norm(n_).split()[-1] for n_ in ents[r_]["spell"] if norm(n_)}
                    raw_last = [norm(r0).split()[-1] for r0 in x["raw"] if norm(r0)]
                    if any(w in lasts for w in raw_last): part = False
                links.append((r_, k, part, x, "exact name", "high", "part_of" if part else "same")); res["exact"] += 1
            else:
                ambiguous.append(dict(text=x["raw"].most_common(1)[0][0], key=k, candidates=[ents[r]["canon"] for r in list(ents_)[:6]], why="several companies share this name", n=x["stories"] + x["cci"] + x["odi"])); res["ambiguous"] += 1
            continue
        if len(toks) == 1 and (toks[0] in GENERIC or len(k) < 5):
            res["too_short_to_match"] += 1; continue
        hits = prefix_hits(k)
        if hits and x["legal"]:                        # a complete legal name that differs from every registered one: another company
            res["complete_name_differs"] += 1; continue
        if len(hits) == 1:
            r_ = next(iter(hits)); conf_ = "medium" if len(toks) >= 2 else "low"
            links.append((r_, k, part, x, f'is the start of "{ents[r_]["canon"]}"' + ("" if len(toks) >= 2 else " (one word only)"), conf_, "part_of" if part else "same")); res["prefix_unique"] += 1; continue
        if len(hits) > 1:
            ambiguous.append(dict(text=x["raw"].most_common(1)[0][0], key=k, candidates=sorted(ents[r]["canon"] for r in hits)[:6], why=f"starts {len(hits)} registered names", n=x["stories"] + x["cci"] + x["odi"])); res["ambiguous"] += 1; continue
        # text longer than a registered name: "Tata Steel overseas arm", "Pricol unit" handled by PART strip above
        best = None
        for i in range(len(toks) - 1, 0, -1):
            pre = " ".join(toks[:i])
            if pre in byname and len(byname[pre]) == 1 and i >= 2:
                best = next(iter(byname[pre])); break
        if best:
            links.append((best, k, True, x, f'starts with the registered name "{ents[best]["canon"]}"', "low", "part_of")); res["registered_name_is_start"] += 1
        else:
            res["no_match"] += 1

    # ---- clusters: one per listed company that has proposed links ----
    by_ent = collections.defaultdict(list)
    for r_, k, part, x, rule, conf, rel in links: by_ent[r_].append((k, part, x, rule, conf, rel))
    # registry-side evidence
    shp_by = collections.defaultdict(lambda: dict(n=0, holders=set(), max=(0, None)))
    for s in shp:
        sym = (s.get("symbol") or "").strip()
        if sym and ("s:" + sym) in par:
            e = shp_by[find("s:" + sym)]; e["holders"].add(s["holder"]); 
    clusters = []
    exact_by = collections.defaultdict(lambda: dict(stories=0, s12=0, cci=0, odi=0))
    for r_, k, part, x, rule, conf, rel in links:
        if conf == "high":
            for f in ("stories", "s12", "cci", "odi"): exact_by[r_][f] += x[f]
    for r_, items in by_ent.items():
        review = [i for i in items if i[4] != "high"]
        if not review: continue
        e = ents[r_]
        mem = [dict(name=e["canon"], key=norm(e["canon"]), spellings=e["spell"][:4], relation="same", rule="root", conf="high", warn=None, stories=exact_by[r_]["stories"], d12=exact_by[r_]["s12"], cci=exact_by[r_]["cci"], odi=exact_by[r_]["odi"], filed=len(shp_by[r_]["holders"]) if r_ in shp_by else 0, ids=dict(symbols=e["symbols"], isins=e["isins"]))]
        for k, part, x, rule, conf, rel in sorted(review, key=lambda i: -(i[2]["stories"] * 2 + i[2]["cci"] + i[2]["odi"] * 0.1)):
            warn_ = "Names a part of the company (a unit, plant or stake), not the company itself" if part else ("Also appears as an investor in the news: check it means this company" if k in investor_keys else None)
            mem.append(dict(name=x["raw"].most_common(1)[0][0], key=k, spellings=[s for s, _ in x["raw"].most_common(4)], relation=rel, rule=rule, conf=conf, warn=warn_,
                            stories=x["stories"], d12=x["s12"], cci=x["cci"], odi=x["odi"], filed=0, ids=None))
        tot = lambda f: sum(m[f] for m in mem)
        score = tot("d12") * 2 + tot("stories") + tot("cci") + tot("odi") * 0.05 + (5 if e["src"].get("nse_shareholding") else 0)
        clusters.append(dict(id="co-" + e["id"], kind="company", canon=e["canon"], symbol=(e["symbols"] or [None])[0], isin=e["current_isin"], symbols=e["symbols"], isins=e["isins"], conflict=e["conflict"],
                             members=mem, names=len(mem), d12=tot("d12"), stories=tot("stories"), cci=tot("cci"), odi=tot("odi"), filed=mem[0]["filed"], score=round(score, 1)))
    clusters.sort(key=lambda c: -c["score"])
    stats = dict(built=dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC"), snapshot=TODAY.isoformat(), listed_companies=len(ents), more_than_one_symbol=sum(1 for e in ents.values() if e["conflict"]), more_than_one_isin=sum(1 for e in ents.values() if e["isin_changed"]),
                 free_text_names=len(texts), result=dict(res), clusters=len(clusters), proposed_names=sum(c["names"] - 1 for c in clusters),
                 ambiguous=len(ambiguous), exact_links=res["exact"],
                 stories_linked_exact=sum(x["stories"] for (r_, k, part, x, rule, conf, rel) in links if conf == "high"),
                 stories_linked_if_all_accepted=sum(x["stories"] for (r_, k, part, x, rule, conf, rel) in links),
                 stories_with_target=sum(1 for s in stories))
    exact_list = [dict(text=x["raw"].most_common(1)[0][0], canonical=ents[r_]["canon"], symbol=(ents[r_]["symbols"] or [None])[0], relation=rel, stories=x["stories"], cci=x["cci"], odi=x["odi"])
                  for (r_, k, part, x, rule, conf, rel) in links if conf == "high"]
    json.dump(dict(stats=stats, clusters=clusters, ambiguous=sorted(ambiguous, key=lambda z: -z["n"]), exact=sorted(exact_list, key=lambda z: -(z["stories"] * 2 + z["cci"] + z["odi"] * 0.05))), open(a.out, "w"), ensure_ascii=False, indent=1)
    print(json.dumps(stats, indent=1))
    if a.ui:
        open(a.ui, "w", encoding="utf-8").write("window.ALIAS_CO=" + json.dumps(dict(stats=stats, clusters=clusters[:a.top], ambiguous=sorted(ambiguous, key=lambda z: -z["n"])[:60]), ensure_ascii=False, separators=(",", ":")) + ";")
        print("ui file", a.ui, len(open(a.ui, encoding="utf-8").read()) // 1024, "KB")

if __name__ == "__main__":
    main()
