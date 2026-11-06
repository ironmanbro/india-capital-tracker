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

print("\nFailed:", failed or "none")
sys.exit(1 if failed else 0)
