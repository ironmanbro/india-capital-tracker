#!/usr/bin/env python3
"""Freshness monitor: is every dataset (and every collector) as recent as it should be?

Read-only. Uses the public (publishable) key the website itself uses; nothing is written anywhere.
Exit code 1 when any dataset is past its allowed age, so a scheduled GitHub Actions run turns red and GitHub emails the owner.

Why this exists (Milestone 0 audit): collectors can report success while data goes stale, and `feed_records.as_of` is text in mixed
formats, so "latest" cannot be read with a simple max(). Here every date is parsed first.

Usage:  python3 pipeline/ops/check_freshness.py [--json] ; env SUPABASE_URL / SUPABASE_KEY override the defaults.
"""
import datetime as dt, json, os, re, sys, urllib.parse, urllib.request

URL = os.environ.get("SUPABASE_URL", "https://urpphqybqmxlwhjghsmf.supabase.co").rstrip("/") + "/rest/v1/"
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_zSo8W_FfT_fZEcfMWoumOw_Yv9mmVWB")

# name: (how to read the latest date, allowed age in days, level, why this limit)
# level "fail" turns the run red; "warn" is reported but does not (use for known, accepted gaps; say why).
CHECKS = [
    ("stories (reviewed news/filings)", ("rest", "stories?select=published_at&order=published_at.desc&limit=1", "published_at"), 2, "fail", "hourly collection"),
    ("fpi_flows (NSDL daily)", ("rest", "fpi_flows?select=day&order=day.desc&limit=1", "day"), 5, "fail", "weekends and holidays"),
    ("fpi_monthly (NSDL monthly)", ("rest", "fpi_monthly?select=month&order=month.desc&limit=1", "month"), 62, "fail", "month start date; published after month end"),
    ("fx_ref (FBIL reference rates)", ("rest", "fx_ref?select=day&order=day.desc&limit=1", "day"), 12, "fail", "FBIL public feed runs about a week behind (documented in supabase/functions/fx)"),
    ("fx_reserves (RBI weekly)", ("rest", "fx_reserves?select=week&order=week.desc&limit=1", "week"), 10, "fail", "weekly"),
    ("ccil_fpi (CCIL daily)", ("rest", "ccil_fpi?select=day&order=day.desc&limit=1", "day"), 5, "fail", "weekdays"),
    ("odi_monthly (RBI ODI)", ("rest", "odi_monthly?select=month&order=month.desc&limit=1", "month"), 100, "warn", "RBI lags ~2 months; the cron job is disabled, so this is refreshed by hand"),
    ("fpi_registry.last_seen (NSDL list)", ("rest", "fpi_registry?select=last_seen&order=last_seen.desc&limit=1", "last_seen"), 2, "fail", "hourly"),
    ("ifsca_entities.last_seen", ("rest", "ifsca_entities?select=last_seen&order=last_seen.desc&limit=1", "last_seen"), 2, "fail", "hourly"),
    ("investor_profiles.checked_at (Wikidata)", ("rest", "investor_profiles?select=checked_at&order=checked_at.desc&limit=1", "checked_at"), 21, "warn", "known stale since 29 Oct 2026: the `profiles` edge function has no cron job (loaded by hand)"),
    ("dpiit_fdi.updated_at", ("rest", "dpiit_fdi?select=updated_at&order=updated_at.desc&limit=1", "updated_at"), 200, "warn", "annual DPIIT release loaded once (26 Oct 2026); no refresh job yet"),
    ("feed_records nse_deals (as_of, parsed)", ("feed", "nse_deals"), 5, "fail", "NSE publishes on trading days"),
    ("feed_records fii_dii (as_of, parsed)", ("feed", "fii_dii"), 5, "fail", "NSE publishes on trading days"),
    ("feed_records cci (as_of, parsed)", ("feed", "cci"), 21, "warn", "CCI orders are irregular"),
]
# collector -> allowed hours since its last SUCCESSFUL run (table `runs_latest`)
RUNS = {
    "news": 6, "nse_shp": 6, "nsdl_flows": 6, "nsdl_fpi_list": 6, "sebi_regs": 6, "rbi_regs": 6, "ifsca_regs": 6, "ifsca_directory": 6,
    "news_private": 6, "nse_bulk": 6, "nse_block": 6,
    "fbil_fx": 50, "rbi_fdi": 50, "nse_calendar": 50, "regs_archive": 50, "ccil_fpi": 100, "nsdl_limits": 100, "rbi_reserves": 200,
}

_MON = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}

def parse_date(v):
    """ISO date/timestamp or 'DD-Mon-YYYY' (any case) -> datetime.date; anything else (incl. the 1970 placeholder) -> None."""
    if not v: return None
    s = str(v).strip()
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", s)
    if m: y, mo, d = map(int, m.groups())
    else:
        m = re.match(r"^(\d{1,2})-([A-Za-z]{3})-(\d{4})$", s)
        if not m or m.group(2).lower() not in _MON: return None
        d, mo, y = int(m.group(1)), _MON[m.group(2).lower()], int(m.group(3))
    if y < 1990: return None                      # epoch placeholder rows
    try: return dt.date(y, mo, d)
    except ValueError: return None

def parse_ts(v):
    if not v: return None
    try: return dt.datetime.fromisoformat(str(v).replace("Z", "+00:00").replace(" ", "T"))
    except ValueError: return None

def evaluate(now, observed, runs):
    """Pure function (tested). observed: {check name: latest date or None}; runs: {source: aware datetime of last ok run or None}.
    Returns a list of dict rows with status ok / stale / warn / missing."""
    rows = []
    for name, _src, max_days, level, why in CHECKS:
        latest = observed.get(name)
        if latest is None:
            rows.append(dict(name=name, latest=None, age=None, limit=f"{max_days}d", status="missing" if level == "fail" else "warn", why="no data found; " + why)); continue
        age = (now.date() - latest).days
        status = "ok" if age <= max_days else ("stale" if level == "fail" else "warn")
        rows.append(dict(name=name, latest=latest.isoformat(), age=f"{age}d", limit=f"{max_days}d", status=status, why=why))
    for src, hours in RUNS.items():
        t = runs.get(src)
        if t is None:
            rows.append(dict(name=f"collector: {src}", latest=None, age=None, limit=f"{hours}h", status="missing", why="no successful run recorded")); continue
        age_h = (now - t).total_seconds() / 3600
        rows.append(dict(name=f"collector: {src}", latest=t.strftime("%Y-%m-%d %H:%MZ"), age=f"{age_h:.0f}h", limit=f"{hours}h", status="ok" if age_h <= hours else "stale", why="last successful run"))
    return rows

def get(path):
    req = urllib.request.Request(URL + urllib.parse.quote(path, safe="/?&=.,()*:%-_~!"), headers={"apikey": KEY, "Authorization": "Bearer " + KEY})
    last = None
    for _ in range(3):
        try: return json.load(urllib.request.urlopen(req, timeout=60))
        except Exception as e: last = e            # noqa: BLE001
    raise RuntimeError(f"request failed: {path[:90]} ({last})")

def observe():
    observed = {}
    for name, src, *_ in CHECKS:
        if src[0] == "rest":
            rows = get(src[1])
            observed[name] = (parse_ts(rows[0][src[2]]).date() if rows and parse_ts(rows[0][src[2]]) else parse_date(rows[0][src[2]]) if rows else None)
        else:   # feed_records: as_of is text in mixed formats, so read recent rows and take the max of the parsed dates
            rows = get(f"feed_records?select=as_of&dataset=eq.{src[1]}&order=loaded_at.desc&limit=1000")
            ds = [d for d in (parse_date(r["as_of"]) for r in rows) if d]
            observed[name] = max(ds) if ds else None
    runs = {r["source"]: parse_ts(r["finished_at"]) for r in get("runs_latest?select=source,finished_at")}
    return observed, runs

def main():
    now = dt.datetime.now(dt.timezone.utc)
    observed, runs = observe()
    rows = evaluate(now, observed, runs)
    bad = [r for r in rows if r["status"] in ("stale", "missing")]
    if "--json" in sys.argv: print(json.dumps(rows, indent=1))
    lines = ["| Status | Dataset | Latest | Age | Limit | Note |", "|---|---|---|---|---|---|"]
    icon = {"ok": "ok", "warn": "WARN", "stale": "STALE", "missing": "MISSING"}
    lines += [f"| {icon[r['status']]} | {r['name']} | {r['latest'] or '-'} | {r['age'] or '-'} | {r['limit']} | {r['why']} |" for r in rows]
    out = "\n".join(lines); print(out)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as f: f.write("## Data freshness\n\n" + out + "\n")
    print(f"\n{len(rows)} checks, {len(bad)} failing, {sum(r['status'] == 'warn' for r in rows)} warnings")
    sys.exit(1 if bad else 0)

if __name__ == "__main__": main()
