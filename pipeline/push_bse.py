"""Run on your own computer (BSE blocks GitHub's servers): fetch BSE bulk/block deals and send them to the
bse-ingest function. Needs only SUPABASE_URL and BSE_PUSH_KEY (a key that can write BSE deal rows and nothing else).

    cd pipeline/collectors && python bse_deals.py      # or bse_offline.py with files in downloads/
    cd ../.. && python pipeline/push_bse.py [pipeline/collectors/data]
"""
import json, os, sys, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(__file__))
import load_feeds as lf

BATCH = 500


def send(url, key, recs, evs):
    body = json.dumps({"records": recs, "events": evs}).encode()
    req = urllib.request.Request(f"{url}/functions/v1/bse-ingest", data=body, method="POST",
                                 headers={"x-push-key": key, "Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def main(argv):
    directory = next((a for a in argv if not a.startswith("--")), os.path.join(os.path.dirname(__file__), "collectors", "data"))
    url, key = os.environ.get("SUPABASE_URL", "").rstrip("/"), os.environ.get("BSE_PUSH_KEY")
    recs = list(lf.collect(directory).get("bse_deals", []))
    for r in recs:
        r.pop("dataset", None), r.pop("loaded_at", None)
    evs = lf.bse_events([{"data": r["data"]} for r in recs])
    print(f"BSE deals: {len(recs)}, events: {len(evs)}")
    if "--dry-run" in argv or not (url and key):
        return print("dry run (set SUPABASE_URL and BSE_PUSH_KEY to send)")
    for i in range(0, max(len(recs), len(evs)), BATCH):
        print(send(url, key, recs[i:i + BATCH], evs[i:i + BATCH]))


if __name__ == "__main__":
    main(sys.argv[1:])
