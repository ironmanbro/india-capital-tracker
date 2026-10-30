import os, re, json, time, requests
from bs4 import BeautifulSoup

LIST = "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListingAll=yes&sid={sid}&ssid={ssid}&smid=0"
AJAX = "https://www.sebi.gov.in/sebiweb/ajax/home/getnewslistinfo.jsp"
H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.sebi.gov.in/",
}
# name -> (sid, ssid)
SECTIONS = {
    "public_issues": (3, 15),       # DRHP / RHP / prospectus / abridged prospectus
    "takeovers": (3, 20),           # open offers, letters of offer
    "enforcement_orders": (2, 9),   # orders (adjudication, final, interim)
}
# title words that hint a foreign fund / FPI is involved
# shortcut: title keywords only (no PDF reading), noisy on "Fund"/"Overseas"; upgrade = match against NSDL FPI names
FOREIGN = re.compile(r"\b(FPI|FII|foreign|portfolio investor|Pte\.?|Mauritius|Cayman|Singapore|LLC|L\.L\.C|Overseas|Fund)\b", re.I)
ANCHOR = re.compile(r"anchor", re.I)
PAGE = 25


def fetch_section(name, pages=10):
    sid, ssid = SECTIONS[name]
    s = requests.Session()
    s.headers.update(H)
    s.get(LIST.format(sid=sid, ssid=ssid), timeout=30)  # session cookie
    out, total = [], None
    for n in range(pages):
        d = dict(nextValue=n, next="n", search="", fromDate="", toDate="", fromYear="", toYear="", deptId="",
                 sid=sid, ssid=ssid, smid=0, ssidhidden=ssid, intmid=-1, sText="", ssText="", smText="", doDirect=n)
        r = s.post(AJAX, data=d, headers={"X-Requested-With": "XMLHttpRequest"}, timeout=30)
        r.raise_for_status()
        soup = BeautifulSoup(r.text.split("#@#")[0], "html.parser")
        m = re.search(r"\d+ to \d+ of (\d+) records", soup.get_text())
        total = int(m.group(1)) if m else total
        rows = [tr for tr in soup.select("table tr") if tr.find("td")]
        for tr in rows:
            tds = [td.get_text(" ", strip=True) for td in tr.find_all("td")]
            a = tr.find("a", href=True)
            title = tds[-1] if len(tds) >= 3 else (tds[-1] if tds else "")
            out.append({
                "date": tds[0],
                "type": tds[1] if len(tds) > 2 else None,
                "title": " | ".join(tds[2:]) if len(tds) > 3 else title,
                "url": a["href"] if a else None,
                "foreign_hint": bool(FOREIGN.search(" ".join(tds))),
                "anchor_hint": bool(ANCHOR.search(" ".join(tds))),
            })
        print(f"{name}: {len(out)}/{total}", flush=True)
        if not rows or len(out) >= (total or 0):
            break
        time.sleep(1)
    return list({x["url"] or x["title"]: x for x in out}.values())  # pages shift when new items post mid-run


if __name__ == "__main__":
    os.makedirs("data/sebi", exist_ok=True)
    bad = []
    for name in SECTIONS:
        try:
            rows = fetch_section(name)
            assert rows, "empty"
            with open(f"data/sebi/{name}.json", "w", encoding="utf-8") as f:
                json.dump(rows, f, indent=1, ensure_ascii=False)
            print("saved", name, len(rows))
        except Exception as e:
            print("FAILED", name, e)
            bad.append(name)
    print("Failed:", bad or "none")
