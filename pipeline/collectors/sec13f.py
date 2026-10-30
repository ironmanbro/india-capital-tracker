import os
import sys
import json
import time
import requests
import xml.etree.ElementTree as ET

class SEC13FFilingExtractor:
    def __init__(self, user_agent=None):
        # SEC requires a descriptive User-Agent containing contact details: set SEC_USER_AGENT="YourApp you@yourdomain.com"
        ua = user_agent or os.getenv("SEC_USER_AGENT", "InstitutionalTracker contact@domain.com")
        self.session = requests.Session()
        # no Host header: requests sets it per URL (the pasted one broke data.sec.gov calls)
        self.session.headers.update({"User-Agent": ua, "Accept-Encoding": "gzip, deflate"})

    def _get(self, url):
        r = self.session.get(url, timeout=30)
        r.raise_for_status()
        time.sleep(0.2)  # SEC limit: 10 requests/second
        return r

    def fetch_form_13f_submissions(self, cik="0001067983"):  # Berkshire Hathaway
        """Locate Form 13F-HR (and 13F-HR/A) filings for a CIK."""
        try:
            data = self._get(f"https://data.sec.gov/submissions/CIK{cik.zfill(10)}.json").json()
        except Exception as e:
            print(f"Error fetching SEC 13F metadata: {e}")
            return []
        rec = data.get("filings", {}).get("recent", {})
        out = []
        for form, acc, doc, fdate, period in zip(rec.get("form", []), rec.get("accessionNumber", []), rec.get("primaryDocument", []),
                                                 rec.get("filingDate", []), rec.get("reportDate", [])):
            if form in ("13F-HR", "13F-HR/A"):
                out.append({"cik": cik.zfill(10), "manager": data.get("name"), "form": form, "filingDate": fdate, "periodOfReport": period,
                            "accessionNumber": acc,
                            "folderUrl": f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc.replace('-', '')}/"})
        print(f"Discovered {len(out)} Form 13F filings for CIK {cik}")
        return out

    def fetch_holdings(self, filing):
        """Parse the information-table XML of one filing into one row per position."""
        idx = self._get(filing["folderUrl"] + "index.json").json()["directory"]["item"]
        xmls = [i["name"] for i in idx if i["name"].lower().endswith(".xml") and not i["name"].lower().startswith("primary_doc")]
        if not xmls:
            return []
        # the info table is the XML that is not the cover page; take the largest if several
        name = max(xmls, key=lambda n: int(next(i for i in idx if i["name"] == n).get("size") or 0))
        root = ET.fromstring(self._get(filing["folderUrl"] + name).content)
        rows = []
        for it in root.iter():
            if it.tag.endswith("infoTable"):
                f = {c.tag.split("}")[-1]: c for c in it}
                g = lambda k: f[k].text.strip() if k in f and f[k].text else None
                sh = f.get("shrsOrPrnAmt")
                rows.append({
                    "accessionNumber": filing["accessionNumber"], "periodOfReport": filing["periodOfReport"],
                    "issuer": g("nameOfIssuer"), "class": g("titleOfClass"), "cusip": g("cusip"),
                    "value_usd": int(g("value")) if g("value") else None,  # whole dollars since 2023; thousands before
                    "shares": int(sh.find("{*}sshPrnamt").text) if sh is not None else None,
                    "putCall": g("putCall"), "discretion": g("investmentDiscretion"),
                })
        return rows

    def save_json(self, data, filename):
        os.makedirs("data", exist_ok=True)
        filepath = os.path.join("data", filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=1, ensure_ascii=False)
        print(f"Saved: {filepath}")

if __name__ == "__main__":
    # usage: python sec13f.py [CIK ...]   (default Berkshire)
    ciks = sys.argv[1:] or ["0001067983"]
    ex = SEC13FFilingExtractor()
    index, holdings = [], []
    for c in ciks:
        fl = ex.fetch_form_13f_submissions(c)
        index += fl
        if fl:
            holdings += ex.fetch_holdings(fl[0])  # latest filing only
    if index:
        ex.save_json(index, "sec_13f_filings_index.json")
        ex.save_json(holdings, "sec_13f_holdings_latest.json")
        print(len(holdings), "positions from the latest filing of each manager")
