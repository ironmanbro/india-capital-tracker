"""Python port of supabase/functions/ingest/shp.ts parseShp, plus period-over-period change calculation.

Element names differ between taxonomy versions, so facts are matched by pattern, as in the TS original.
Only named holders at or above `min_pct` are returned (the filings list named holders only at >=1%).
"""
import re
import xml.etree.ElementTree as ET
from collections import defaultdict

PARSER_VERSION = "py-1"
FOREIGN_NAMES = re.compile(r"foreign|fpi|fii|overseas", re.I)
CATEGORY = re.compile(r"foreign portfolio[a-z ]*|foreign[a-z ]*|insurance[a-z ]*|mutual fund[a-z ]*|bodies corporate|promoter[a-z ]*|individual[a-z ]*", re.I)


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def _num(s):
    try:
        return float(s.replace(",", ""))
    except (ValueError, AttributeError):
        return None


def parse_shp(xml_bytes, min_pct=1.0):
    head = xml_bytes[:4096].lstrip()
    if re.search(rb"<!DOCTYPE|<!ENTITY", xml_bytes[:4096], re.I):
        raise ValueError("DOCTYPE/ENTITY not allowed")  # untrusted input: no entity expansion
    root = ET.fromstring(xml_bytes)
    ctx, facts = {}, {}
    for el in root.iter():
        n = _local(el.tag)
        if n == "context":
            cid = el.get("id")
            period = next((((c.text or "").strip()) for c in el.iter() if _local(c.tag) in ("instant", "endDate")), "")
            dims = " ".join(f"{m.get('dimension', '')} {''.join(m.itertext()).strip()}" for m in el.iter() if _local(m.tag) in ("explicitMember", "typedMember"))
            ctx[cid] = (period, dims)
        elif el.get("contextRef") and (el.text or "").strip():
            key = re.sub(r"^D_", "", el.get("contextRef"))
            facts.setdefault(key, {})[n] = el.text.strip()

    def pick(g, *res):
        for re_ in res:
            for k, v in g.items():
                if re_.search(k):
                    return v
        return ""

    def anyf(*res):
        for re_ in res:
            for g in facts.values():
                for k, v in g.items():
                    if re_.search(k):
                        return v
        return ""

    rows = []
    for ref, g in facts.items():
        holder = pick(g, re.compile(r"^NameOf(The)?Shareholders?$", re.I), re.compile(r"NameOf(The)?Shareholder|ShareholderName", re.I))
        pct = _num(pick(g, re.compile(r"ShareholdingAsAPercentage|AsAPercentageOfTotal", re.I), re.compile(r"Percent", re.I)))
        if not holder or pct is None:
            continue
        shares = _num(pick(g, re.compile(r"^NumberOfFullyPaidUpEquityShares", re.I), re.compile(r"^NumberOfShares$", re.I)))
        dims = (ctx.get(ref) or ctx.get("D_" + ref) or ("", ""))[1]
        where = re.sub(r"([a-z])([A-Z])", r"\1 \2", re.sub(r"Member\b", "", re.sub(r"_Context\d*I?$", "", ref) + " " + dims))
        m = CATEGORY.search(re.sub(r"[^A-Za-z]+", " ", where))
        category = m.group(0).strip() if m else ""
        foreign = bool(re.search(r"foreign|fpi|fii|overseas", where, re.I)) or (not category and bool(FOREIGN_NAMES.search(holder)))
        rows.append({"holder": holder, "pct": pct, "shares": shares, "category": category, "foreign": foreign})
    if rows and all(r["pct"] <= 1 for r in rows):  # fractions -> percent
        for r in rows:
            r["pct"] = round(r["pct"] * 100, 4)
    periods = sorted(p for p, _ in ctx.values() if p)
    date = anyf(re.compile(r"DateOfReport|PeriodEnd|QuarterEnd|ShareholdingPatternAsOn", re.I)) or (periods[-1] if periods else "")
    return {
        "company": anyf(re.compile(r"^NameOfTheCompany$|NameOfTheListedEntity|^NameOfCompany$", re.I), re.compile(r"CompanyName|EntityName", re.I)),
        "symbol": anyf(re.compile(r"^Symbol$|NSESymbol|ScripSymbol", re.I), re.compile(r"ScripCode", re.I)),
        "period_end": date[:10] if re.match(r"\d{4}-\d{2}-\d{2}", date) else "",
        "parser_version": PARSER_VERSION,
        "rows": sorted((r for r in rows if r["pct"] >= min_pct), key=lambda r: -r["pct"]),
    }


def _hkey(h):
    return re.sub(r"[^a-z0-9]+", " ", h.lower()).strip()


def compute_changes(filings):
    """filings: parse_shp outputs (with 'symbol', 'period_end'). Compares consecutive periods per company+holder.

    pct_point_change is latest minus previous percentage, in percentage points (not relative %).
    A holder present in only one period is reported as 'entered_list'/'left_list' with no change value: it may
    have crossed the 1% naming threshold rather than bought or sold.
    """
    by_co = defaultdict(dict)
    for f in filings:
        if f["symbol"] and f["period_end"]:
            by_co[f["symbol"]][f["period_end"]] = f  # re-filed duplicates for a period: last one wins
    out = []
    for sym, per in by_co.items():
        ps = sorted(per)
        for prev_p, last_p in zip(ps, ps[1:]):
            prev = {_hkey(r["holder"]): r for r in per[prev_p]["rows"]}
            last = {_hkey(r["holder"]): r for r in per[last_p]["rows"]}
            for k in prev.keys() | last.keys():
                a, b = prev.get(k), last.get(k)
                row = {"symbol": sym, "holder": (b or a)["holder"], "category": (b or a)["category"], "foreign": (b or a)["foreign"],
                       "previous_period": prev_p, "latest_period": last_p,
                       "previous_pct": a and a["pct"], "latest_pct": b and b["pct"],
                       "previous_shares": a and a["shares"], "latest_shares": b and b["shares"],
                       "previous_source_url": per[prev_p].get("source_url"), "latest_source_url": per[last_p].get("source_url")}
                if a and b:
                    row["status"] = "comparable"
                    row["pct_point_change"] = round(b["pct"] - a["pct"], 4)
                    row["shares_change"] = b["shares"] - a["shares"] if a["shares"] is not None and b["shares"] is not None else None
                else:
                    row["status"] = "entered_list" if b else "left_list"
                    row["pct_point_change"] = row["shares_change"] = None
                out.append(row)
    return sorted(out, key=lambda r: (r["symbol"], r["latest_period"], r["holder"]))
