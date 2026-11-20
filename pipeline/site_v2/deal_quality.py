"""Quality rules applied to each deal row before it is published (Deals and Investors pages).

1. role:  who the investor really is.
     "intermediary" - a bank trading desk, market maker or offshore derivative (P-note) issuer; it trades for clients or to hedge,
                      so its exchange buys are not foreign money choosing India.
     "domestic"     - an Indian institution (NPS, LIC, Indian mutual funds and insurers) that turned up in a foreign-capital row.
     "foreign"      - everything else.
   The lists are hand-kept and deliberately narrow: a name is only moved out of "foreign" when it plainly matches.
2. sg:    the stage bucket. "done" (completed), "announced" (agreed or in talks) or "pledge" (a plan or a pledge).
          Values in different buckets must never be added together.
3. chk:   a note when the stored US$ amount disagrees with the amount in the headline by more than 1.5x. When the headline
          states exactly one amount and the stored value is about 10x smaller (the model's known rupee slip), the headline amount
          replaces it (old value kept as usd0, fix=1). Anything else (valuations, "anchor demand", merged reports) is only
          flagged "check amount": a headline figure is not always the deal size.
"""
import math, re

INTERMEDIARY = [
    r"\bsociete generale\b", r"\bbnp paribas (arbitrage|financial markets)\b", r"\bmorgan stanley asia\b",
    r"\bgoldman sachs (bank europe|international|\(singapore\))", r"\bcitigroup global markets\b", r"\bjp ?morgan (securities|structured)\b",
    r"\bmerrill lynch\b", r"\bbofa securities\b", r"\bnomura (singapore|financial products)\b", r"\bcopthall mauritius\b",
    r"\bubs (ag|securities)\b", r"\bbarclays (bank|capital)\b", r"\bhsbc bank\b", r"\bgraviton\b", r"\bjane street\b",
    r"\bcitadel securities\b", r"\bvirtu\b", r"\bqe securities\b", r"\boptiver\b", r"\bxtx\b", r"\btower research\b",
    r"\bmacquarie bank\b", r"\bclsa\b",
]
DOMESTIC = [
    r"\bnational pension system\b", r"\bnps trust\b", r"\blife insurance corporation\b", r"\blic of india\b",
    r"\bsbi (mutual fund|life|funds)\b", r"\bhdfc (mutual fund|life|trustee)\b", r"\bicici prudential\b", r"\bnippon life india\b",
    r"\bkotak mahindra (mutual|trustee|life)\b", r"\baxis (mutual fund|max life)\b", r"\bmirae asset mutual fund\b",
    r"\baditya birla sun life\b", r"\bdsp (mutual|trustee)\b", r"\buti (mutual|trustee)\b", r"\bmotilal oswal mutual\b",
    r"\bppfas\b", r"\bquant mutual\b", r"\bbandhan mutual\b", r"\bemployees.? provident fund\b",
]
_I = re.compile("|".join(INTERMEDIARY), re.I)
_D = re.compile("|".join(DOMESTIC), re.I)

def role(name, country=None):
    n = name or ""
    if _I.search(n): return "intermediary"
    if _D.search(n): return "domestic"
    return "foreign"

STAGE_BUCKET = {"completed": "done", "agreed": "announced", "talks": "announced", "plan": "pledge", "pledge": "pledge"}

def bucket(stage):
    return STAGE_BUCKET.get(stage or "", "announced")

_AMT = re.compile(r"(?:US\$|\$|USD\s?)\s?([\d][\d,]*(?:\.\d+)?)\s?(billion|bn|million|mn|m)\b", re.I)
_INR = re.compile(r"(?:Rs\.?|₹|INR)\s?([\d][\d,]*(?:\.\d+)?)\s?(lakh crore|crore|cr)\b", re.I)

def headline_usd_m(title, inr_per_usd=None):
    """Every amount in the headline, in US$ mn. Rupee amounts are converted only when a rate is given."""
    out = []
    for v, u in _AMT.findall(title or ""):
        x = float(v.replace(",", "")); out.append(x * 1000 if u.lower().startswith("b") else x)
    if inr_per_usd:
        for v, u in _INR.findall(title or ""):
            x = float(v.replace(",", "")) * (1e5 if u.lower().startswith("lakh") else 1)   # crore
            out.append(x * 10 / inr_per_usd)                                                  # 1 crore = 10 mn rupees
    return out

def amount_check(usd, title, inr_per_usd=None, tol=1.5):
    """None when the amount is fine or cannot be checked; otherwise a short note for the page."""
    if not usd: return None
    hs = [h for h in headline_usd_m(title, inr_per_usd) if h > 0]
    if not hs: return None
    if any(abs(math.log(usd / h)) <= math.log(tol) for h in hs): return None
    return "headline says US$ " + " / ".join(f"{h:,.0f}" for h in hs) + " mn"

def apply(row, inr_per_usd=None):
    """Adds role, sg and (when needed) chk to one deals.js row, in place."""
    row["role"] = role(row.get("inv"), row.get("ic"))
    row["sg"] = bucket(row.get("stage"))
    if row.get("g") == "C":
        c = amount_check(row.get("usd"), row.get("t"), inr_per_usd)
        if c:
            row["chk"] = c
            hs = headline_usd_m(row.get("t"), inr_per_usd)
            if len(hs) == 1 and 8 <= hs[0] / row["usd"] <= 12:      # the known 10x rupee slip: correct it, keep the old value
                row["usd0"], row["usd"] = row["usd"], round(hs[0], 1); del row["chk"]; row["fix"] = 1
    return row
