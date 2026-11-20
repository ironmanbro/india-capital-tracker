"""Run every scraper in order. Output lands in ./data (and nse_shareholding_cleaned.json in the cwd).

mca.py is not in the list: it needs a paid gateway key and company names as arguments (see its top).
"""
import os, subprocess, sys, time

SCRIPTS = ["final.py", "tracker.py", "ipo.py", "fpi_final.py", "sector.py", "nsdl_all.py", "bse_deals.py", "cci.py", "rbi.py",
           "sebi.py", "startup_rss.py", "sec13f.py", "exchange.py", "dpiit.py", "gdelt.py",
           "fx.py", "announcements.py", "pib.py", "history.py"]

failed = []
PER_SCRIPT_SECONDS = 600  # one slow or blocked site must not hold up the rest

for s in SCRIPTS:
    print(f"\n=== {s} ===", flush=True)
    try:
        if subprocess.run([sys.executable, s], timeout=PER_SCRIPT_SECONDS).returncode != 0:
            failed.append(s)
    except subprocess.TimeoutExpired:
        print(f"TIMED OUT after {PER_SCRIPT_SECONDS}s: {s}", flush=True)
        failed.append(s)
    time.sleep(2)

# If BSE's live feed failed, use a bulk/block file downloaded by hand into downloads/ (if there is one).
if "bse_deals.py" in failed and os.path.isdir("downloads"):
    print("\n=== bse_offline.py (fallback) ===", flush=True)
    if subprocess.run([sys.executable, "bse_offline.py"]).returncode == 0:
        failed.remove("bse_deals.py")

# Failures that are understood and handled elsewhere (e.g. BSE blocks GitHub's servers with HTTP 403; its deals are pushed from the
# owner's computer). Named in ICT_ACCEPTED_FAILURES (comma separated). They are still printed, but do not fail the run.
accepted = {x.strip() for x in os.environ.get("ICT_ACCEPTED_FAILURES", "").split(",") if x.strip()}
unexpected = [f for f in failed if f not in accepted]
print("\nFailed:", failed or "none")
if failed and not unexpected:
    print("All failures are in ICT_ACCEPTED_FAILURES:", sorted(accepted))
sys.exit(1 if unexpected else 0)
