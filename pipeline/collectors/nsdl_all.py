import os, re, json, time, requests, pandas as pd
from io import StringIO
from bs4 import BeautifulSoup

B = "https://www.fpi.nsdl.co.in/web/"
PAGES = {
    "fpi_latest": "Reports/Latest.aspx",
    "fpi_current_month": "Reports/Monthly.aspx",
    "fpi_investment_calendar_year": "Reports/Yearwise.aspx?RptType=6",
    "fpi_investment_financial_year": "Reports/Yearwise.aspx?RptType=5",
    "fpi_auc_country_top10": "Reports/ReportDetail.aspx?RepID=14",
    "fpi_auc_category": "Reports/ReportDetail.aspx?RepID=18",
    "fpi_auc_category_custodians": "Reports/ReportDetail.aspx?RepID=22",
    "fpi_bidding_details": "Reports/ReportDetail.aspx?RepID=2",
    "fpi_odi_pn_value": "Reports/ReportDetail.aspx?RepID=28",
    "debt_limit_govt": "Reports/ReportDetail.aspx?RepID=5",
    "debt_limit_govt_long_term": "Reports/ReportDetail.aspx?RepID=6",
    "debt_limit_corporate": "Reports/ReportDetail.aspx?RepID=7",
    "debt_limit_corporate_infra": "Reports/ReportDetail.aspx?RepID=8",
    "trade_wise_equity": "StaticReports/FIITradeWise2008/FIITradeWise2008.htm",
    "trade_wise_debt": "StaticReports/FIITradeWiseDebt/FIITradeWiseDebt.htm",
    "breach_3pct_utilization": "Reports/Utilization_Breach_Limit_Report.aspx",
    "breach_size": "Reports/Size_Limit_50k_CR_Only_LEI.aspx",
    "breach_concentration": "Reports/Concentration_Limit_Breach_50_Per.aspx",
    "fpi_registration_data": "Reports/FPI_Registration_Data.aspx",
    "ddp_pendency": "StaticReports/DDP_Pendency_Report/DDP_Pendency_Report.htm",
}
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
     "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
     "Accept-Language": "en-US,en;q=0.9", "Accept-Encoding": "gzip, deflate",
     "Referer": "https://www.fpi.nsdl.co.in/"}

def flatten(df):
    if isinstance(df.columns, pd.MultiIndex):
        cols = []
        # levels identical across every column are titles/footnotes, not headers
        const = {i for i in range(df.columns.nlevels) if df.columns.get_level_values(i).nunique() == 1}
        for col in df.columns:
            parts = []
            for i, c in enumerate(col):
                if i in const:
                    continue
                c = str(c).strip()
                if "Unnamed" not in c and c not in parts:
                    parts.append(c)
            cols.append(re.sub(r"Currency: INRUSD_?", "", "_".join(parts)))
        named = [c for c in cols if c]  # a blank spacer column would defeat the common prefix
        pre = os.path.commonprefix(named)
        pre = pre[:pre.rfind("_") + 1] if len(named) > 1 else ""  # shared title prefix, cut at a "_" boundary
        df.columns = [c[len(pre):] for c in cols]
        df = df.loc[:, df.columns != ""]
    else:
        df.columns = [str(c).strip() for c in df.columns]
    return df

NUM = re.compile(r"^\(?-?[\d,]*\.?\d+\)?$")

def num(v):
    """'(812.73)' -> -812.73, 'Rs.95.37' -> 95.37, '1,234' -> 1234; ids/codes with leading zeros stay strings."""
    if not isinstance(v, str):
        return v
    x = v.strip().replace("Rs.", "").replace("\xa0", "")
    if not NUM.match(x):
        return v
    neg = x.startswith("(") or x.startswith("-")
    x = x.strip("()-").replace(",", "")
    if (len(x) > 1 and x[0] == "0" and "." not in x) or len(x.replace(".", "")) > 15:
        return v
    f = float(x)
    f = -f if neg else f
    return int(f) if f.is_integer() and "." not in x else f

def clean_rows(rows):
    """Drop footnote rows (one text repeated across every column) and convert numbers."""
    out = []
    for r in rows:
        vals = list(r.values())
        if len(vals) > 2 and len(set(map(str, vals))) == 1 and vals[0] != "":
            continue
        out.append({k: num(v) for k, v in r.items()})
    return out

def tables(html):
    """Leaf tables only: wrapper tables nest the real ones and come out as junk."""
    out, seen = [], set()
    for t in BeautifulSoup(html, "html.parser").find_all("table"):
        if t.find("table") or len(t.find_all("tr")) < 2:
            continue
        try:
            df = pd.read_html(StringIO(str(t)))[0]
        except ValueError:
            continue
        if df.shape[1] < 2:
            continue
        df = flatten(df)
        if len(set(df.columns)) == 1:  # header is a footnote row; real header is row 0
            df.columns = [str(v).strip() for v in df.iloc[0]]
            df = df.iloc[1:]
        if list(df.columns)[:3] == ["0", "1", "2"] or list(df.columns)[:2] == ["0", "1"]:
            hi = next((i for i in range(min(4, len(df))) if len(set(map(str, df.iloc[i]))) == df.shape[1]), None)
            if hi is not None:  # first row with all-distinct cells is the header
                df.columns = [str(v).strip() for v in df.iloc[hi]]
                df = df.iloc[hi + 1:]
        rows = clean_rows(df.astype(object).fillna("").to_dict(orient="records"))
        key = json.dumps(rows, default=str)
        if key in seen:  # NSDL renders many tables twice
            continue
        seen.add(key)
        h = t.find_previous(string=re.compile(r"::.+::"))
        out.append({"title": h.strip(" :\r\n\t") if h else "", "rows": rows})
    return out

def get(url):
    for _ in range(2):
        try:
            return requests.get(url, headers=H, timeout=45)
        except requests.RequestException as e:
            err = e
    raise err

def hidden_fields(html):
    s = BeautifulSoup(html, "html.parser")
    return {i["name"]: i.get("value", "") for i in s.find_all("input", type="hidden") if i.get("name")}

def scrape_quarterly():
    """Quarterly page: year dropdown 'ddl' posts back (ASP.NET __doPostBack); default view is the newest year."""
    url = B + "Reports/QuarterlyWise.aspx"
    s = requests.Session(); s.headers.update(H)
    # NSDL sometimes answers 200 with an error or holding page that has no year picker; wait and ask again before giving up.
    for attempt in range(3):
        page = s.get(url, timeout=45).text
        sel = BeautifulSoup(page, "html.parser").find("select", {"name": "ddl"})
        if sel: break
        time.sleep(15 * (attempt + 1))
    else:
        raise RuntimeError("NSDL quarterly page has no year picker after 3 tries: " + re.sub(r"\s+", " ", BeautifulSoup(page, "html.parser").get_text())[:150])
    years = [o.get("value") for o in sel.find_all("option")]
    out = {}
    for y in years:
        form = hidden_fields(page)
        form.update({"__EVENTTARGET": "ddl", "__EVENTARGUMENT": "", "ddl": y})
        r = s.post(url, data=form, timeout=45)
        ts = tables(r.text)
        # keep tables that hold quarterly rows; the year-picker header table is a 1-row table and is skipped by tables()
        out[y] = [t["rows"] for t in ts]
        time.sleep(1)
    return out


def scrape_fpi_list():
    """List of FPIs: the page's own AJAX endpoint returns the whole registry in one POST (Search='%')."""
    url = B + "Reports/RegisteredFIISAFPI.aspx"
    s = requests.Session(); s.headers.update(H)
    s.get(url, timeout=60)
    s.headers.update({"Accept": "application/json, text/javascript, */*; q=0.01", "Referer": url, "X-Requested-With": "XMLHttpRequest"})
    form = {"type": "0", "Search": "%", "RegNo": "", "CategoryId": "", "SubCategoryId": "", "CountryId": "", "StatusId": "", "RegTypeId": ""}
    rows = s.post(url + "?action=getregdata", data=form, timeout=120).json()["Table"]
    # keep identity/classification fields only; address, phone and fax are not needed for a public site
    keep = ["Appl_Nm", "Reg_No", "Reg_Date", "CountryName", "ClientType", "Category_nm", "SubCategory", "StatusName"]
    return [{k: r.get(k) for k in keep} for r in rows]


if __name__ == "__main__":
    os.makedirs("data/nsdl", exist_ok=True)
    for name, path in PAGES.items():
        try:
            r = get(B + path)
            if r.status_code != 200:
                print(f"{name}: HTTP {r.status_code}"); continue
            ts = tables(r.text)
            if not ts:
                print(f"{name}: no data tables"); continue
            with open(f"data/nsdl/{name}.json", "w") as f:
                json.dump(ts, f, indent=2, default=str)
            print(f"{name}: {len(ts)} tables, rows {[len(t['rows']) for t in ts][:8]}")
        except Exception as e:
            print(f"{name}: ERROR {type(e).__name__}: {str(e)[:80]}")
        time.sleep(1)
    q = scrape_quarterly()
    with open("data/nsdl/fpi_quarterly_net_investment.json", "w") as f:
        json.dump(q, f, indent=2, default=str)
    print("fpi_quarterly_net_investment:", {y: [len(t) for t in v] for y, v in q.items()})
    fl = scrape_fpi_list()
    with open("data/nsdl/list_of_fpis.json", "w") as f:
        json.dump(fl, f, indent=2)
    print("list_of_fpis:", len(fl), "records")
