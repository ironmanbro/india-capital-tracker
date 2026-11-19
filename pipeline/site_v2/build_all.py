#!/usr/bin/env python3
"""Builds every data file of the /v2 pages into --out (default ../../site/v2). All builders run first; files are written only if ALL succeed
and pass their checks, so a bad fetch leaves the previous files (and the site) as they were. Exit code 1 means nothing was changed.
Usage: python3 build_all.py [--out DIR] [--only data,deals,inv,reg,regs,limits,scorecard]"""
import argparse, importlib, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import write_js, BuildError

FILES = [("data", "data.js"), ("deals", "deals.js"), ("inv", "inv.js"), ("reg", "reg.js"), ("regs", "regs.js"), ("limits", "limits.js"), ("scorecard", "scorecard.js")]

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "site", "v2")); ap.add_argument("--only", default="")
    a = ap.parse_args(); want = set(filter(None, a.only.split(",")))
    built = []
    for mod, fname in FILES:
        if want and mod not in want: continue
        t0 = time.time()
        try:
            var, obj = importlib.import_module("build_" + mod).build()
        except BuildError as e:
            print(f"FAIL  {mod}: {e}"); sys.exit(1)
        except Exception as e:                      # noqa: BLE001
            print(f"FAIL  {mod}: unexpected error: {e!r}"); sys.exit(1)
        built.append((fname, var, obj)); print(f"ok    {mod:6} {time.time()-t0:5.1f}s")
    os.makedirs(a.out, exist_ok=True)
    for fname, var, obj in built:
        write_js(os.path.join(a.out, fname), var, obj); print(f"wrote {fname:9} {os.path.getsize(os.path.join(a.out, fname))//1024:5} KB")

if __name__ == "__main__": main()
