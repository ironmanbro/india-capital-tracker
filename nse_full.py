#!/usr/bin/env python3
"""Fetch NSE's corporate shareholding-pattern master list, clean and de-duplicate it, and save it.

    python nse_full.py                      # live fetch (equities and SME)
    python nse_full.py --from-file raw.json # clean a saved payload instead (offline test)

Output: data/nse_shareholding_cleaned.json. The file is only replaced when a run produced records.
One session, a handful of requests, polite pauses. Needs: requests.
"""
import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import requests

BASE = "https://www.nseindia.com"
PAGE = BASE + "/companies-listing/corporate-filings-shareholding-pattern"
API = BASE + "/api/corporate-share-holdings-master?index={index}"
INDICES = ("equities", "sme")
OUT = Path(__file__).parent / "data" / "nse_shareholding_cleaned.json"
FIELDS = ("symbol", "name", "isin", "date", "revisedStatus", "typeOfSubmission", "pr_and_prgrp", "public_val")
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
}


def new_session() -> requests.Session:
    """Open the NSE home page and the filings page first so the session carries the cookies the API expects."""
    s = requests.Session()
    s.headers.update(HEADERS)
    s.get(BASE, timeout=20)
    time.sleep(1)
    s.get(PAGE, timeout=20, headers={"Referer": BASE})
    time.sleep(1)
    return s


def fetch(session: requests.Session, index: str, tries: int = 3):
    last = None
    for n in range(tries):
        try:
            r = session.get(API.format(index=index), timeout=40, headers={"Referer": PAGE})
            r.raise_for_status()
            return r.json()
        except (requests.RequestException, ValueError) as e:
            last = e
            time.sleep(2 * (n + 1))
    raise RuntimeError(f"{index}: {last}")


def as_records(payload):
    """The master list may come as a bare list or wrapped under a key such as 'data'."""
    if isinstance(payload, list):
        return payload
    if isinstance(payload, dict):
        for k in ("data", "records", "rows"):
            if isinstance(payload.get(k), list):
                return payload[k]
    return []


def number(v):
    try:
        return float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def iso(d):
    """NSE writes dates like 30-SEP-2026; keep ISO yyyy-mm-dd, and the original text when it cannot be read."""
    if not d:
        return None
    for fmt in ("%d-%b-%Y", "%d-%m-%Y", "%Y-%m-%d", "%d %b %Y"):
        try:
            return datetime.strptime(str(d).strip().title(), fmt).date().isoformat()
        except ValueError:
            continue
    return str(d).strip()


def clean(records):
    """Keep the wanted fields and drop duplicates: one row per symbol, date, submission type and revised status."""
    out, seen = [], set()
    for r in records:
        if not isinstance(r, dict) or not r.get("symbol"):
            continue
        row = {k: r.get(k) for k in FIELDS}
        row["symbol"] = str(row["symbol"]).strip().upper()
        row["name"] = (row["name"] or "").strip()
        row["isin"] = (row["isin"] or "").strip() or None
        row["date"] = iso(row["date"])
        row["pr_and_prgrp"] = number(row["pr_and_prgrp"])
        row["public_val"] = number(row["public_val"])
        key = (row["symbol"], row["date"], row["typeOfSubmission"], row["revisedStatus"])
        if key in seen:
            continue
        seen.add(key)
        out.append(row)
    out.sort(key=lambda x: (x["symbol"], x["date"] or ""))
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from-file", help="clean this saved JSON payload instead of fetching")
    args = ap.parse_args()

    raw = []
    if args.from_file:
        raw = as_records(json.loads(Path(args.from_file).read_text()))
    else:
        session = new_session()
        for index in INDICES:
            got = as_records(fetch(session, index))
            print(f"{index}: {len(got)} records")
            raw += got
            time.sleep(2)
    rows = clean(raw)
    if not rows:
        print("No records; leaving the existing file untouched.", file=sys.stderr)
        return 1
    OUT.parent.mkdir(parents=True, exist_ok=True)
    doc = {"fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "NSE corporate-share-holdings-master",
           "raw_records": len(raw), "records": len(rows), "data": rows}
    tmp = OUT.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=1))
    tmp.replace(OUT)
    print(f"Saved {len(rows)} records ({len(raw) - len(rows)} duplicates or empty rows removed) to {OUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
