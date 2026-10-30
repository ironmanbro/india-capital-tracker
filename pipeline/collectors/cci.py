import os, re, json, time, requests
from bs4 import BeautifulSoup

URL = "https://www.cci.gov.in/combination/orders-section31"
H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "Accept-Encoding": "gzip, deflate",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": URL,
}
COLS = ["DT_RowIndex", "combination_no", "party_name", "form_type", "notification_date",
        "order_status", "decision_date", "summary_files", "order_files"]
PAGE = 100

def text(html):
    return BeautifulSoup(str(html or ""), "html.parser").get_text(" ", strip=True)

def links(html):
    return [a["href"] for a in BeautifulSoup(str(html or ""), "html.parser").find_all("a", href=True)]

def fetch_all(fromdate="", todate="", form_type="", order_status=""):
    s = requests.Session()
    s.headers.update(H)
    s.get(URL, timeout=30)  # cookies / CSRF session
    out, start, draw = [], 0, 1
    while True:
        p = {"draw": draw, "start": start, "length": PAGE, "order[0][column]": 0, "order[0][dir]": "desc",
             "form_type": form_type, "order_status": order_status, "searchString": "", "search_type": "",
             "fromdate": fromdate, "todate": todate}
        for i, c in enumerate(COLS):
            p[f"columns[{i}][data]"] = c
            p[f"columns[{i}][name]"] = c
        r = s.get(URL, params=p, timeout=60)
        r.raise_for_status()
        j = r.json()
        rows = j.get("data", [])
        for d in rows:
            out.append({
                "combination_no": text(d.get("combination_no")),
                "parties": text(d.get("party_name")),
                "form": text(d.get("form_type")),
                "notification_date": text(d.get("notification_date")),
                "status": text(d.get("order_status")),
                "decision_date": text(d.get("decision_date")),
                "summary_links": links(d.get("summary_files")),
                "order_links": links(d.get("order_files")),
            })
        start += PAGE
        draw += 1
        print(f"{len(out)}/{j.get('recordsFiltered')}", flush=True)
        if not rows or start >= int(j.get("recordsFiltered", 0)):
            break
        time.sleep(1)
    return out

if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)
    rows = fetch_all()
    with open("data/cci_merger_approvals.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1, ensure_ascii=False)
    print("saved", len(rows))
