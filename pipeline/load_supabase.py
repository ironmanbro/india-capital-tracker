"""Upsert the processed NSE CSVs into Supabase through PostgREST (stdlib only, idempotent).

Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (never logged). Without them, or with --dry-run, only counts rows.
Usage: python3 pipeline/load_supabase.py [data/processed] [--dry-run]
"""
import csv, json, os, sys, urllib.error, urllib.request

BATCH = 500
# table -> (csv file, on_conflict columns, csv->column renames, int cols, numeric cols, bool cols, columns kept)
TABLES = {
    "nse_filings": ("nse_shareholding_filings.csv", "url", {}, {"http_status", "parsed_records", "size"}, set(), set(),
                    ["url", "segment", "symbol", "isin", "company_name", "reporting_period", "filing_date", "doc_id", "retrieved_at",
                     "http_status", "download_status", "file_type", "size", "sha256", "error", "parser_status", "parsed_records", "parser_version"]),
    "nse_holdings": ("nse_holdings.csv", "symbol,reporting_period,investor_name,source_document_hash", {"foreign": "foreign_flag"}, set(),
                     {"shares_held", "percentage_held"}, {"foreign_flag"},
                     ["exchange", "symbol", "company_name", "reporting_period", "filing_date", "investor_category", "investor_name", "shares_held",
                      "percentage_held", "foreign_flag", "source_url", "source_document_hash", "parser_version"]),
    "nse_ownership_changes": ("nse_ownership_changes.csv", "symbol,holder,previous_period,latest_period", {"foreign": "foreign_flag"}, set(),
                              {"previous_pct", "latest_pct", "previous_shares", "latest_shares", "pct_point_change", "shares_change"}, {"foreign_flag"},
                              ["symbol", "holder", "category", "foreign_flag", "previous_period", "latest_period", "previous_pct", "latest_pct",
                               "previous_shares", "latest_shares", "pct_point_change", "shares_change", "status"]),
}


def read_rows(path, spec):
    _, _, rename, ints, nums, bools, cols = spec
    if not os.path.exists(path):
        return []
    out = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            r = {rename.get(k, k): v for k, v in r.items()}
            row = {}
            for c in cols:
                v = r.get(c)
                if v in (None, "", "None"):
                    row[c] = None  # blanks stay null, never zero
                elif c in ints:
                    row[c] = int(float(v))
                elif c in nums:
                    row[c] = float(v)
                elif c in bools:
                    row[c] = v == "True"
                else:
                    row[c] = v
            out.append(row)
    return out


def post(url, key, table, conflict, rows, opener=urllib.request.urlopen):
    req = urllib.request.Request(f"{url}/rest/v1/{table}?on_conflict={conflict}", data=json.dumps(rows).encode(), method="POST",
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                                          "Prefer": "resolution=merge-duplicates,return=minimal"})
    try:
        with opener(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{table}: HTTP {e.code} {e.read()[:300].decode('utf-8', 'replace')}") from None  # key is never in the message


def load(processed_dir, url=None, key=None, dry_run=False, opener=urllib.request.urlopen):
    counts = {}
    for table, spec in TABLES.items():
        rows = read_rows(os.path.join(processed_dir, spec[0]), spec)
        # holdings need a hash and changes need periods to satisfy NOT NULL / unique keys; skip and count the rest
        rows = [r for r in rows if all(r.get(k.strip()) is not None for k in spec[1].split(","))]
        counts[table] = len(rows)
        if dry_run or not (url and key):
            continue
        for i in range(0, len(rows), BATCH):
            post(url.rstrip("/"), key, table, spec[1], rows[i:i + BATCH], opener)
    return counts


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry = "--dry-run" in sys.argv
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not dry and not (url and key):
        print("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set: dry run only"); dry = True
    print(json.dumps({"dry_run": dry, "rows": load(args[0] if args else "data/processed", url, key, dry)}))
