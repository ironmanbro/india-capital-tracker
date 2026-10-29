"""NSE shareholding-pattern master collector (stdlib only).

Fetches the equities/SME master, snapshots the raw response, normalises it into filing references, and
downloads each filing into a resumable, hash-checked manifest. Field names in the master are NOT verified
against the live API (NSE was unreachable from the build sandbox), so `normalise` maps by candidate key
names and keeps the full original record in `raw`; nothing is invented when a key is missing.
"""
import csv, hashlib, http.cookiejar, json, os, random, re, time, urllib.error, urllib.request
from datetime import datetime, timezone

BASE = "https://www.nseindia.com"
MASTER = BASE + "/api/corporate-share-holdings-master?index={index}"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": BASE + "/companies-listing/corporate-filings-shareholding-pattern",
}
MAX_BYTES = 25 * 1024 * 1024
SIGNATURES = {"zip": b"PK\x03\x04", "pdf": b"%PDF", "xml": b"<"}  # xml/xbrl: first non-space byte is '<'
ALIASES = {  # candidate source keys per normalised field; first present wins
    "company_name": ("name", "companyName", "company"),
    "symbol": ("symbol", "Symbol"),
    "isin": ("isin", "ISIN"),
    "reporting_period": ("date", "asOnDate", "quarter", "period"),
    "filing_date": ("submissionDate", "broadcastDate", "filingDate"),
    "doc_id": ("recordID", "recordId", "id", "seqId"),
    "url": ("xbrl", "xbrlLink", "attachment"),
}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def safe_name(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("._")[:120] or "file"


class Client:
    def __init__(self, interval=2.0, retries=4, timeout=(10, 30), opener=None, sleep=time.sleep):
        self.interval, self.retries, self.timeout, self.sleep = interval, retries, timeout[1], sleep
        self.opener = opener or urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self._last = 0.0

    def get(self, url, max_bytes=MAX_BYTES):
        """Returns (status, content_type, body). Retries 429/5xx/network errors with backoff+jitter."""
        for attempt in range(self.retries + 1):
            wait = self.interval - (time.monotonic() - self._last)
            if wait > 0:
                self.sleep(wait)
            self._last = time.monotonic()
            try:
                with self.opener.open(urllib.request.Request(url, headers=HEADERS), timeout=self.timeout) as r:
                    body = r.read(max_bytes + 1)
                    if len(body) > max_bytes:
                        return r.status, r.headers.get("Content-Type", ""), None  # too large
                    return r.status, r.headers.get("Content-Type", ""), body
            except urllib.error.HTTPError as e:
                if e.code not in (429, 500, 502, 503, 504):
                    return e.code, "", None
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                pass
            if attempt < self.retries:
                self.sleep(2 ** attempt + random.random())
        return 0, "", None


def fetch_master(client, index, raw_dir):
    """Fetch one master, validate JSON list, save a timestamped raw snapshot. Returns (records, meta)."""
    url = MASTER.format(index=index)
    client.get(BASE)  # cookie priming, as in the reference implementation
    status, ctype, body = client.get(url)
    meta = {"index": index, "url": url, "http_status": status, "content_type": ctype, "retrieved_at": now(), "records": 0, "error": None}
    if status != 200 or body is None:
        meta["error"] = f"http {status}" if body is None else None
        return [], meta
    try:
        data = json.loads(body)
        if isinstance(data, dict):  # tolerate {"data": [...]}
            data = next((v for v in data.values() if isinstance(v, list)), None)
        if not isinstance(data, list):
            raise ValueError("response is not a JSON list")
    except ValueError as e:
        meta["error"] = f"invalid json: {e}"
        return [], meta
    os.makedirs(raw_dir, exist_ok=True)
    path = os.path.join(raw_dir, f"{index}_{meta['retrieved_at'].replace(':', '')}.json")
    with open(path, "wb") as f:
        f.write(body)
    meta.update(records=len(data), snapshot=path, sha256=hashlib.sha256(body).hexdigest())
    return data, meta


def normalise(records, exchange_index):
    """Map master records to filing references. Missing fields stay None; the original record is kept."""
    out = []
    for r in records:
        row = {"exchange": "NSE", "segment": exchange_index, "raw": r}
        for field, keys in ALIASES.items():
            row[field] = next((r[k] for k in keys if r.get(k) not in (None, "", "-")), None)
        out.append(row)
    return out


def dedupe(rows):
    """Drop repeated (segment, symbol, period, url) rows; report overlap of symbols across segments."""
    seen, uniq = set(), []
    for r in rows:
        k = (r["segment"], r["symbol"], r["reporting_period"], r["url"])
        if k not in seen:
            seen.add(k)
            uniq.append(r)
    by_seg = {}
    for r in uniq:
        by_seg.setdefault(r["symbol"], set()).add(r["segment"])
    overlap = sorted(s for s, v in by_seg.items() if s and len(v) > 1)
    return uniq, overlap


def detect_type(body):
    head = body.lstrip()[:8]
    for t, sig in SIGNATURES.items():
        if head.startswith(sig) or body.startswith(sig):
            return t
    return None


def load_manifest(path):
    if not os.path.exists(path):
        return {}
    with open(path, newline="") as f:
        return {r["url"]: r for r in csv.DictReader(f)}


MANIFEST_FIELDS = ["url", "exchange", "segment", "symbol", "isin", "company_name", "reporting_period", "filing_date",
                   "doc_id", "retrieved_at", "http_status", "download_status", "file_type", "size", "sha256", "path", "error"]


def save_manifest(path, manifest):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", newline="") as f:
        w = csv.DictWriter(f, MANIFEST_FIELDS, extrasaction="ignore")
        w.writeheader()
        w.writerows(manifest.values())
    os.replace(tmp, path)  # atomic: a crash never leaves a half-written manifest


def download_all(client, rows, manifest_path, files_dir, limit=None):
    """Resumable: URLs already 'ok' in the manifest are skipped. Checkpoints after every file."""
    manifest = load_manifest(manifest_path)
    done = 0
    for r in rows:
        url = r["url"]
        if not url or (manifest.get(url, {}).get("download_status") == "ok"):
            continue
        if limit is not None and done >= limit:
            break
        done += 1
        if not url.startswith("https://") or "nseindia.com" not in url.split("/")[2]:
            entry = {"download_status": "rejected_host", "error": "non-NSE or non-https url"}
            status = 0
        else:
            status, ctype, body = client.get(url)
            entry = {"download_status": "failed", "error": None}
            if body is None:
                entry["error"] = f"http {status} or over size limit"
            elif not body:
                entry["error"] = "empty body"
            elif (ft := detect_type(body)) is None:
                entry["error"] = "unrecognised file signature"
            else:
                digest = hashlib.sha256(body).hexdigest()
                period = (r["reporting_period"] or "unknown")
                path = os.path.join(files_dir, safe_name(period)[:7] or "unknown", f"{safe_name(r['symbol'] or 'NA')}_{digest[:12]}.{ft}")
                os.makedirs(os.path.dirname(path), exist_ok=True)
                with open(path, "wb") as f:
                    f.write(body)
                entry.update(download_status="ok", file_type=ft, size=len(body), sha256=digest, path=path)
        manifest[url] = {**{k: r.get(k) for k in MANIFEST_FIELDS}, "retrieved_at": now(), "http_status": status, **entry}
        save_manifest(manifest_path, manifest)
    return manifest


def run(data_dir="data", interval=2.0, download_limit=50):
    client = Client(interval=interval)
    rows, metas = [], []
    for index in ("equities", "sme"):
        recs, meta = fetch_master(client, index, os.path.join(data_dir, "raw/nse/masters", index))
        metas.append(meta)
        rows += normalise(recs, index)
    rows, overlap = dedupe(rows)
    manifest = download_all(client, rows, os.path.join(data_dir, "manifests/nse_download_manifest.csv"),
                            os.path.join(data_dir, "raw/nse/shareholding_filings"), download_limit)
    cov = {"masters": metas, "filing_refs": sum(1 for r in rows if r["url"]), "records": len(rows),
           "equities_sme_overlap_symbols": overlap, "downloaded_ok": sum(1 for m in manifest.values() if m["download_status"] == "ok"),
           "note": "Coverage measured from master only; historical depth is not assumed."}
    os.makedirs(os.path.join(data_dir, "manifests"), exist_ok=True)
    with open(os.path.join(data_dir, "manifests/nse_historical_coverage.json"), "w") as f:
        json.dump(cov, f, indent=2)
    return cov


if __name__ == "__main__":
    print(json.dumps(run(), indent=2))
