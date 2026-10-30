import os, re, io, json, time, requests
import pandas as pd
from bs4 import BeautifulSoup

B = "https://www.rbi.org.in/Scripts/"
H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",  # */* needed: rbidocs gives 406 on html-only Accept
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.rbi.org.in/",
}
S = requests.Session()
S.headers.update(H)
os.makedirs("data/rbi", exist_ok=True)


def get(url):
    r = S.get(url, timeout=60)
    r.raise_for_status()
    time.sleep(1)
    return r


def save(name, obj):
    with open(f"data/rbi/{name}.json", "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=1, ensure_ascii=False, default=str)
    print("saved", name, len(obj))


def leaf_tables(html):
    s = BeautifulSoup(html, "html.parser")
    return [t for t in s.find_all("table") if not t.find("table") and len(t.find_all("tr")) > 2]


def table_rows(t):
    return [[c.get_text(" ", strip=True) for c in tr.find_all(["th", "td"])] for tr in t.find_all("tr")]


def release_links(section_id, kw=None):
    """prids (newest first) listed on a RBI data-release section page."""
    s = BeautifulSoup(get(f"{B}Pr_DataRelease.aspx?SectionID={section_id}&DateFilter=Year").text, "html.parser")
    out = []
    for a in s.find_all("a", href=True):
        if "prid=" in a["href"].lower() and (not kw or re.search(kw, a.get_text(" ", strip=True), re.I)):
            out.append((a.get_text(" ", strip=True), B + a["href"].split("/")[-1]))
    return out


def xlsx_link(page_url):
    s = BeautifulSoup(get(page_url).text, "html.parser")
    for a in s.find_all("a", href=True):
        if re.search(r"\.xlsx?$", a["href"], re.I):
            return a["href"]


def sheet_records(url):
    """Every sheet -> list of non-empty rows (header-agnostic; RBI sheets have title rows)."""
    xl = pd.read_excel(io.BytesIO(get(url).content), sheet_name=None, header=None)
    out = {}
    for name, df in xl.items():
        df = df.dropna(how="all").dropna(axis=1, how="all")
        out[name] = [[None if pd.isna(v) else v for v in row] for row in df.values.tolist()]
    return out


# --- weekly reserves -------------------------------------------------------
def weekly_reserves():
    path = "data/rbi/weekly_reserves.json"
    hist = {}
    if os.path.exists(path):
        hist = {r["as_on"]: r for r in json.load(open(path, encoding="utf-8"))}  # history accumulates across runs
    idx = BeautifulSoup(get(B + "BS_PressReleaseDisplay.aspx").text, "html.parser")
    urls = {B + a["href"] for a in idx.find_all("a", href=True)
            if "prid=" in a["href"] and "Weekly Statistical Supplement" in a.get_text(" ", strip=True)}
    for u in sorted(urls):
        html = get(u).text
        for t in leaf_tables(html):
            rows = table_rows(t)
            if not rows[0][0].lower().startswith("2. foreign exchange"):
                continue
            m = next((re.search(r"As on (.+)", c) for r in rows[:3] for c in r if re.search(r"As on", c)), None)
            as_on = m.group(1).strip() if m else None
            items = {}
            for r in rows:
                mm = re.match(r"^(\d+(?:\.\d+)?)\s+(.*)", r[0]) if r else None
                if mm and len(r) >= 7:
                    items[mm.group(2).strip()] = {"inr_cr": r[1], "usd_mn": r[2], "wk_chg_inr_cr": r[3], "wk_chg_usd_mn": r[4],
                                                  "vs_end_mar_inr_cr": r[5], "vs_end_mar_usd_mn": r[6]}
            if as_on and items:
                hist[as_on] = {"as_on": as_on, "source": u, "items": items}
    save("weekly_reserves", sorted(hist.values(), key=lambda r: pd.to_datetime(r["as_on"], errors="coerce")))


# --- IIP (incl. direct investment) -----------------------------------------
def iip():
    title, url = release_links(356)[0]
    tabs = [table_rows(t) for t in leaf_tables(get(url).text)]
    save("iip_latest", [{"release": title, "url": url, "tables": tabs}])


# --- BoP invisibles (quarterly xlsx) ---------------------------------------
def invisibles():
    title, url = release_links(346)[0]
    x = xlsx_link(url)
    save("bop_invisibles_latest", [{"release": title, "url": url, "xlsx": x, "sheets": sheet_records(x)}])


# --- overseas direct investment (monthly xlsx) -----------------------------
def odi():
    title, url = release_links(347)[0]
    x = xlsx_link(url)
    save("overseas_direct_investment_latest", [{"release": title, "url": url, "xlsx": x, "sheets": sheet_records(x)}])


if __name__ == "__main__":
    bad = []
    for fn in (weekly_reserves, iip, invisibles, odi):
        try:
            fn()
        except Exception as e:
            print("FAILED", fn.__name__, e)
            bad.append(fn.__name__)
    print("Failed:", bad or "none")
