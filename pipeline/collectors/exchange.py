import os, io, re, json, time, zipfile, datetime as dt, requests
import pandas as pd

NSE = "https://www.nseindia.com"
ARCH = "https://nsearchives.nseindia.com/content/nsccl"
H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",  # no br: NSE replies brotli and requests can't decode it
    "Referer": "https://www.nseindia.com/",
}
s = requests.Session()
s.headers.update(H)
os.makedirs("data/exchange", exist_ok=True)


def save(name, rows):
    with open(f"data/exchange/{name}.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1, ensure_ascii=False, default=str)
    print("saved", name, len(rows))


def nse_api(path):
    r = s.get(NSE + path, timeout=60)
    r.raise_for_status()
    time.sleep(1)
    j = r.json()
    return j["data"] if isinstance(j, dict) and "data" in j else j


def window(days=365):
    t = dt.date.today()
    return f"from_date={t - dt.timedelta(days=days):%d-%m-%Y}&to_date={t:%d-%m-%Y}"


# shortcut: one 365-day window per call; short windows came back empty from the API, so no per-day paging
def insider_trading():
    save("nse_insider_trading", nse_api(f"/api/corporates-pit?index=equities&{window()}"))


def sast_reg29():
    save("nse_sast_reg29", nse_api(f"/api/corporate-sast-reg29?index=equities&{window()}"))


def pledged_shares():
    save("nse_pledged_shares", nse_api("/api/corporate-pledgedata?index=equities"))


def participant_csv(stem, days=7):
    """FII / DII / Pro / Client positions from the daily NSE archive CSVs; skips holidays (404)."""
    out, d = [], dt.date.today()
    for _ in range(days):
        u = f"{ARCH}/{stem}_{d:%d%m%Y}.csv"
        r = s.get(u, timeout=60)
        if r.status_code == 200:
            df = pd.read_csv(io.StringIO(r.content.decode("utf-8-sig")), skiprows=1)
            df.columns = [c.strip() for c in df.columns]
            df = df.dropna(how="all")
            for rec in df.to_dict("records"):
                out.append({"date": d.isoformat(), **{k: (v.strip() if isinstance(v, str) else v) for k, v in rec.items()}})
        d -= dt.timedelta(days=1)
        time.sleep(0.5)
    return out


def participant_oi():
    save("nse_participant_oi", participant_csv("fao_participant_oi"))


def participant_volume():
    save("nse_participant_volume", participant_csv("fao_participant_vol"))


# India INX (GIFT City). Bhavcopy is a zip of CSVs linked from the daily market data page.
def india_inx_bhavcopy():
    r = requests.get("https://www.indiainx.com/markets/dailymarketdata.aspx",
                     headers={**H, "Accept": "text/html,*/*;q=0.8", "Referer": "https://www.indiainx.com/"}, timeout=60)
    r.raise_for_status()
    links = re.findall(r"https://www\.indiainx\.com/downloads/BhavCopy/ZIP/\d+/[A-Za-z_0-9]+\.zip", r.text)
    assert links, "no bhavcopy link on the INX page"
    z = zipfile.ZipFile(io.BytesIO(requests.get(links[0], headers=H, timeout=120).content))
    rows = []
    for n in z.namelist():
        if n.lower().endswith(".csv"):
            # files have no header row; only the columns I could confirm are named (c4=instrument, c5=symbol, c6=expiry)
            df = pd.read_csv(z.open(n), header=None).dropna(how="all")
            df.columns = [f"c{i}" for i in df.columns]
            df = df.rename(columns={"c0": "date", "c4": "instrument", "c5": "symbol", "c6": "expiry"})
            df = df.astype(object).where(df.notna(), None)  # NaN is not valid JSON
            rows += [{"file": n, **rec} for rec in df.to_dict("records")]
    save("india_inx_bhavcopy_latest", rows)


if __name__ == "__main__":
    s.get(NSE + "/", timeout=30)  # cookie handshake
    bad = []
    for fn in (insider_trading, sast_reg29, pledged_shares, participant_oi, participant_volume, india_inx_bhavcopy):
        try:
            fn()
        except Exception as e:
            print("FAILED", fn.__name__, e)
            bad.append(fn.__name__)
    print("Failed:", bad or "none")
