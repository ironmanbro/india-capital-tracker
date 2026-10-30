import os, sys, json, requests

H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.bseindia.com/",
    "Origin": "https://www.bseindia.com",
}
URL = "https://api.bseindia.com/BseIndiaAPI/api/BulkBlockDeal/w?flag={flag}&Fdt=&Tdt=&scripcode="

def fetch(flag):
    s = requests.Session()
    s.headers.update(H)
    s.get("https://www.bseindia.com/", timeout=20)
    r = s.get(URL.format(flag=flag), timeout=20)
    if r.status_code != 200:
        raise RuntimeError(f"BSE {flag}: HTTP {r.status_code} {r.text[:80]!r}")
    d = r.json()
    return d.get("Table", d) if isinstance(d, dict) else d

if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)
    bad = False
    for flag in ("Bulk", "Block"):
        try:
            rows = fetch(flag)
            with open(f"data/bse_{flag.lower()}_deals.json", "w", encoding="utf-8") as f:
                json.dump(rows, f, ensure_ascii=False, indent=1)
            print(flag, len(rows), "records")
        except Exception as e:
            print("FAILED", e)
            bad = True
    sys.exit(1 if bad else 0)
