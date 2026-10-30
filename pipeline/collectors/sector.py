import os, json, requests, pandas as pd
from io import StringIO

BASE = "https://www.fpi.nsdl.co.in/web/StaticReports/Fortnightly_Sector_wise_FII_Investment_Data/FIIInvestSector_{}.html"
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
     "Accept": "text/html,*/*;q=0.8", "Accept-Encoding": "gzip, deflate"}

def fetch_sector(stamp="Oct152026"):
    html = requests.get(BASE.format(stamp), headers=H, timeout=40).text
    df = pd.read_html(StringIO(html), header=None)[0]
    keep = [c for c in df.columns if df.iloc[4:, c].notna().any()]
    df = df[keep]
    names = []
    for c in df.columns:
        parts = []
        for r in range(4):
            v = df.iloc[r][c]
            if pd.notna(v) and str(v).strip() not in parts:
                parts.append(str(v).strip())
        names.append("_".join(parts))
    body = df.iloc[4:].copy()
    body.columns = names
    return body.astype(object).fillna("").to_dict(orient="records")

if __name__ == "__main__":
    rows = fetch_sector()
    os.makedirs("data", exist_ok=True)
    with open("data/fpi_sector_allocations.json", "w") as f:
        json.dump(rows, f, indent=2)
    print(len(rows), "rows;", len(rows[0]), "cols")
    print(list(rows[0])); print(rows[0]); print(rows[-1])
