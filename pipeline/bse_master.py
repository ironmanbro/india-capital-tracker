"""BSE shareholding-pattern collector: DISABLED until BSE's real endpoint, field names and licence are confirmed.

Nothing here is verified against BSE (unreachable from the build sandbox; no endpoint was invented). To enable,
create pipeline/bse_config.json after inspecting BSE's shareholding-pattern interface and licensing:
  {"enabled": true, "listing_url": "<tested https url returning a JSON list>", "allowed_hosts": ["bseindia.com"],
   "field_map": {"company_name": ["..."], "symbol": [...], "isin": [...], "reporting_period": [...],
                 "filing_date": [...], "doc_id": [...], "url": [...]}}
It reuses the NSE collector's client, manifest, download checks and parser.
"""
import json, os
import nse_master as n

CONFIG = os.path.join(os.path.dirname(__file__), "bse_config.json")
STATUS = {"source": "BSE shareholding pattern", "access_status": "unverified", "licensing_status": "unreviewed", "enabled": False}


class BseDisabled(RuntimeError):
    pass


def load_config(path=CONFIG):
    if not os.path.exists(path):
        raise BseDisabled("BSE collector disabled: no bse_config.json (endpoint, field map and licence not verified)")
    cfg = json.load(open(path))
    missing = [k for k in ("listing_url", "allowed_hosts", "field_map") if not cfg.get(k)]
    if not cfg.get("enabled") or missing:
        raise BseDisabled("BSE collector disabled or incomplete config: missing " + ", ".join(missing or ["enabled=true"]))
    if not cfg["listing_url"].startswith("https://"):
        raise BseDisabled("listing_url must be https")
    return cfg


def normalise(records, field_map):
    """Map records with the configured key names; fields not mapped or absent stay None (never invented)."""
    out = []
    for r in records:
        row = {"exchange": "BSE", "segment": "bse", "raw": r}
        for field in n.ALIASES:
            row[field] = next((r[k] for k in field_map.get(field, ()) if r.get(k) not in (None, "", "-")), None)
        out.append(row)
    return out


def match_by_isin(nse_rows, bse_rows):
    """Canonical companies keyed by ISIN. Rows without an ISIN are returned unmatched, never matched by name."""
    canon, unmatched = {}, []
    for r in list(nse_rows) + list(bse_rows):
        isin = (r.get("isin") or "").strip().upper()
        if not isin:
            unmatched.append(r)
            continue
        c = canon.setdefault(isin, {"isin": isin, "exchanges": {}})
        c["exchanges"].setdefault(r["exchange"], []).append(r)
    return canon, unmatched


def run(data_dir="data", interval=3.0, download_limit=50, config_path=CONFIG, client=None):
    cfg = load_config(config_path)
    client = client or n.Client(interval=interval)
    recs, meta = n.fetch_json(client, cfg["listing_url"], "bse", os.path.join(data_dir, "raw/bse/masters"))
    rows, _ = n.dedupe(normalise(recs, cfg["field_map"]))
    manifest = n.download_all(client, rows, os.path.join(data_dir, "manifests/bse_download_manifest.csv"),
                              os.path.join(data_dir, "raw/bse/shareholding_filings"), download_limit, tuple(cfg["allowed_hosts"]))
    return {"master": meta, "filing_refs": sum(1 for r in rows if r["url"]),
            "downloaded_ok": sum(1 for m in manifest.values() if m["download_status"] == "ok")}


if __name__ == "__main__":
    try:
        print(json.dumps(run(), indent=2))
    except BseDisabled as e:
        print(e)
