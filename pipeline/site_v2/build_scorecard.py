"""scorecard.js: Deal Outcomes. What happened to the share price after a named client traded in NSE's bulk and block deal files.

Method (also printed on the page; keep both in step):
  * Observation = one client, one share, one day, one side (buy or sell). Same-day trades are combined (quantity added, price averaged by value);
    a trade that appears in both the bulk and the block file is counted once.
  * Return = close on the first trading day on or after (deal date + 30, 90 or 180 calendar days) against the deal's weighted average price,
    adjusted for splits and bonuses with NSE's own corporate-action factors. Excess = that return minus the Nifty 500 move over the same days.
  * An observation is left out of a horizon (never guessed) when the horizon has not been reached, the share has no close that day,
    NSE's corporate-action list for the share is unavailable, a corporate action NSE does not give a price factor for (rights, demerger...) falls
    inside the window, or the adjusted move is implausible (below -90% or above +300%): these are counted in meta.
  * Clients are classed by NAME rules (see klass). Individuals and HUFs are not published at all.
Nothing here predicts anything; it records outcomes after public trades."""
import collections, datetime as dt, os, re
from common import paged, norm, built_stamp, BuildError
from nse_prices import Prices, Actions

HORIZONS = (30, 90, 180)
MAXFETCH = int(os.environ.get("SC_MAX_FETCH", "450"))      # price files fetched per run; the rest follow on the next run
MAXCA = int(os.environ.get("SC_MAX_CA", "250"))            # corporate-action lookups per run

PERSON = re.compile(r"\b(huf|shri|smt|mr|mrs|ms|kumari|minor)\b")
ODI = re.compile(r"\bodi\b|participatory|\bp notes?\b")
FUNDWORD = re.compile(r"\b(fund|funds|fds|trust|trst|mutual|pension|insurance|assurance|sicav|ucits)\b")
BANK = re.compile(r"\b(goldman sachs|morgan stanley|bofa|bank of america|merrill|jp ?morgan|j p morgan|citigroup|citibank|barclays|bnp paribas|societe generale|nomura|ubs|deutsche|credit suisse|hsbc|macquarie|jefferies|clsa|ing bank|standard chartered|natixis|mizuho|smbc|daiwa|investec)\b")
DEALER = re.compile(r"\b(securities|broking|stock broking|share broking|shares and|markets?|trading|traders?|research|quant\w*|derivatives|brokers?|intermediar\w*|finsol|marketedge|wealth|graviton|alphagrep|qicap|mathisys|hrti|flow traders|optiver|hudson river|citadel|millennium|tower research|imc|dolat|jump trading)\b")
FUND = re.compile(r"\b(capital|partners|holdings|investment|investments|advisors?|advisers?|management|master|growth|equity|ventures|asset|assets|opportunities|crossover|lp|l p|gic|temasek|norges|fidelity|vanguard|blackrock|government|global|emerging|international)\b")

def klass(name):
    """fund (a fund or other institutional investor) | bank (global bank or broker-dealer desk) | dealer (market maker, proprietary trader or Indian broker) | odi (offshore derivative instrument issuer) | None (individual, operating company or unclassifiable: not published).
    Rules run on the plain lower-case name (not the cleaned matching key, which deletes words such as fund, llc and inc). Strong fund words are tested before bank and
    dealer words, so "Goldman Sachs Funds" and "GQG Partners Emerging Markets Equity Fund" are funds. Legal suffixes (Ltd, Inc, AG, B.V.) alone never make a fund."""
    k = re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()
    if not k or PERSON.search(k): return None
    if ODI.search(k): return "odi"
    if FUNDWORD.search(k): return "fund"
    if BANK.search(k): return "bank"
    if DEALER.search(k): return "dealer"
    if FUND.search(k): return "fund"
    return None

def parse_day(s): return dt.datetime.strptime(s.strip().title(), "%d-%b-%Y").date()

def deals():
    rows, seen = [], set()
    raw = paged("feed_records?select=key,data&dataset=eq.nse_deals")
    for x in sorted(raw, key=lambda x: (not x["key"].startswith("BLOCK"), x["key"])):       # the block copy of a duplicated trade wins
        d = x["data"]
        try: day, qty, px = parse_day(d["date"]), int(float(d["qty"])), float(d["watp"])
        except (KeyError, ValueError, TypeError): continue
        client, side, sym = (d.get("clientName") or "").strip(), d.get("buySell"), (d.get("symbol") or "").strip()
        if not (client and sym and qty > 0 and px > 0 and side in ("BUY", "SELL")): continue
        key = (day, sym, client, side, qty)
        if key in seen: continue
        seen.add(key); rows.append(dict(day=day, sym=sym, client=client, side="B" if side == "BUY" else "S", qty=qty, px=px, block=x["key"].startswith("BLOCK")))
    return rows

def build():
    rows = deals()
    if len(rows) < 500: raise BuildError(f"only {len(rows)} exchange deals")
    cnt = collections.Counter()
    # combine same client, share, day, side
    agg = {}
    for r in rows:
        c = klass(r["client"])
        if c is None: cnt["not_published_individual_or_unclassified"] += 1; continue
        k = (norm(r["client"]), r["sym"], r["day"], r["side"])
        a = agg.setdefault(k, dict(client=collections.Counter(), cls=c, qty=0, val=0.0, block=False, sym=r["sym"], day=r["day"], side=r["side"]))
        a["client"][r["client"]] += 1; a["qty"] += r["qty"]; a["val"] += r["qty"] * r["px"]; a["block"] |= r["block"]
    obs = list(agg.items())
    syms = {o["sym"] for _, o in obs}
    P = Prices(syms, budget=MAXFETCH)
    A = Actions(budget=MAXCA); A.refresh(sorted(syms))
    # the last day with prices, for meta
    out_ents = {}
    pend = collections.Counter(); drop = collections.Counter()
    for (ck, sym, day, side), o in obs:
        ent = out_ents.setdefault(ck, dict(k=ck, n=o["client"].most_common(1)[0][0], c=o["cls"], o=[]))
        px = o["val"] / o["qty"]
        d0 = P.on_or_before(day, 0)                      # the deal day itself (a trading day)
        b0 = P.bench(d0) if d0 else None
        r_, b_, adjusted = [], [], False
        for h in HORIZONS:
            t = P.on_or_after(day + dt.timedelta(days=h))
            if t is None or d0 is None: pend[h] += 1; r_.append(None); b_.append(None); continue
            pt, b1 = P.px(sym, t), P.bench(t)
            if pt is None or b0 is None or b1 is None: drop[("no_price", h)] += 1; r_.append(None); b_.append(None); continue
            f, hit = A.factor(sym, day, t)
            if f is None: drop[("actions_unknown", h)] += 1; r_.append(None); b_.append(None); continue
            odd = [x for x in (A.data[sym]["a"]) if day < dt.date.fromisoformat(x[0]) <= t and x[1] not in ("SPLIT", "BONUS")]
            if odd: drop[("other_corporate_action", h)] += 1; r_.append(None); b_.append(None); continue
            ret = pt / (px * f) - 1
            if ret < -0.9 or ret > 3.0: drop[("implausible", h)] += 1; r_.append(None); b_.append(None); continue
            adjusted |= f != 1.0
            r_.append(round(ret * 100, 1)); b_.append(round((b1 / b0 - 1) * 100, 1))
        ent["o"].append([day.isoformat(), sym, side, o["qty"], round(px, 2), round(o["val"] / 1e7, 2), 1 if o["block"] else 0, *r_, *b_, 1 if adjusted else 0])
    P.save()
    ents = sorted(out_ents.values(), key=lambda e: -len(e["o"]))
    for e in ents: e["o"].sort(reverse=True)
    last = max((d for d, v in P.days.items() if v), default=None)
    cls_n = collections.Counter(e["c"] for e in ents)
    return "SC", dict(
        ents=ents, last_price_day=last, universe=len(syms), cached_actions=len(A.data),
        counts=dict(deals=len(rows), observations=len(obs), published_clients=len(ents), classes=dict(cls_n), **{k: v for k, v in cnt.items()}),
        pending={str(h): pend[h] for h in HORIZONS},
        dropped={f"{why}:{h}": n for (why, h), n in sorted(drop.items())},
        fetched=dict(price_files=P.fetched, errors=P.errors, action_calls=A.calls),
        horizons=list(HORIZONS), bench="Nifty 500", built=built_stamp())
