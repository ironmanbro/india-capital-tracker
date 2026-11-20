import datetime as dt, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "ops"))
import check_freshness as cf

NOW = dt.datetime(2026, 11, 20, 12, 0, tzinfo=dt.timezone.utc)

def test_parse_date_formats():
    assert cf.parse_date("2026-11-03") == dt.date(2026, 11, 3)
    assert cf.parse_date("02-Nov-2026") == dt.date(2026, 11, 2)
    assert cf.parse_date("30-OCT-2026") == dt.date(2026, 10, 30)           # NSE upper-case months
    assert cf.parse_date("2026-11-20T01:50:04.331+00:00") == dt.date(2026, 11, 20)
    assert cf.parse_date("1970-01-01") is None                             # epoch placeholder
    assert cf.parse_date(None) is None and cf.parse_date("") is None and cf.parse_date("n/a") is None
    assert cf.parse_date("31-Feb-2026") is None

def _all_fresh():
    obs = {name: NOW.date() for name, *_ in cf.CHECKS}
    runs = {s: NOW for s in cf.RUNS}
    return obs, runs

def test_all_fresh_is_ok():
    obs, runs = _all_fresh()
    assert {r["status"] for r in cf.evaluate(NOW, obs, runs)} == {"ok"}

def test_stale_and_warn_levels():
    obs, runs = _all_fresh()
    obs["fx_ref (FBIL reference rates)"] = NOW.date() - dt.timedelta(days=13)       # past 12 d limit, level fail
    obs["investor_profiles.checked_at (Wikidata)"] = NOW.date() - dt.timedelta(days=60)  # level warn
    st = {r["name"]: r["status"] for r in cf.evaluate(NOW, obs, runs)}
    assert st["fx_ref (FBIL reference rates)"] == "stale"
    assert st["investor_profiles.checked_at (Wikidata)"] == "warn"

def test_fx_lag_of_a_week_is_accepted():
    obs, runs = _all_fresh()
    obs["fx_ref (FBIL reference rates)"] = NOW.date() - dt.timedelta(days=7)     # state on 20 Nov 2026
    assert {r["name"]: r["status"] for r in cf.evaluate(NOW, obs, runs)}["fx_ref (FBIL reference rates)"] == "ok"

def test_missing_data_and_old_collector():
    obs, runs = _all_fresh()
    obs["fpi_flows (NSDL daily)"] = None
    runs["news"] = NOW - dt.timedelta(hours=30)
    runs["nse_block"] = None
    st = {r["name"]: r["status"] for r in cf.evaluate(NOW, obs, runs)}
    assert st["fpi_flows (NSDL daily)"] == "missing"
    assert st["collector: news"] == "stale"
    assert st["collector: nse_block"] == "missing"
