"""NSE corporate announcements for the last 30 days, kept only when they concern foreign or large-holder activity."""
import os, re, json, time, datetime as dt, requests

H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
     "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate", "Referer": "https://www.nseindia.com/"}
KEEP = re.compile(r"open offer|preferential|qualified institutions|\bQIP\b|anchor investor|foreign portfolio|\bFPI\b|foreign investor|warrants|substantial acquisition|takeover|stake|private placement|FCCB|ADR|GDR", re.I)
s = requests.Session()
s.headers.update(H)
s.get("https://www.nseindia.com/", timeout=30)
t = dt.date.today()
r = s.get(f"https://www.nseindia.com/api/corporate-announcements?index=equities&from_date={t - dt.timedelta(days=30):%d-%m-%Y}&to_date={t:%d-%m-%Y}", timeout=90)
r.raise_for_status()
j = r.json()
rows = j["data"] if isinstance(j, dict) and "data" in j else j
keep = [{"symbol": x.get("symbol"), "company": x.get("sm_name"), "subject": x.get("desc"), "text": (x.get("attchmntText") or "")[:400],
         "date": x.get("an_dt") or x.get("sort_date"), "file": x.get("attchmntFile")} for x in rows if KEEP.search(f"{x.get('desc') or ''} {x.get('attchmntText') or ''}")]
assert rows, "empty announcement list"
os.makedirs("data", exist_ok=True)
json.dump(keep, open("data/nse_announcements.json", "w"), indent=1, ensure_ascii=False)
print("saved", len(keep), "of", len(rows), "announcements")
