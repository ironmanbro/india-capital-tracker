"""Run every scraper in order. Output lands in ./data (and nse_shareholding_cleaned.json in the cwd)."""
import subprocess, sys, time

SCRIPTS = ["final.py", "tracker.py", "ipo.py", "fpi_final.py", "sector.py", "nsdl_all.py"]

failed = []
for s in SCRIPTS:
    print(f"\n=== {s} ===", flush=True)
    if subprocess.run([sys.executable, s]).returncode != 0:
        failed.append(s)
    time.sleep(2)

print("\nFailed:", failed or "none")
sys.exit(1 if failed else 0)
