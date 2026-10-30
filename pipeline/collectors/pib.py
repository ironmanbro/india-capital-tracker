"""PIB (Government of India press releases) feed, kept only when it mentions investment or FDI policy."""
import os, re, json, html, requests
import xml.etree.ElementTree as ET

URLS = [f"https://pib.gov.in/RssMain.aspx?ModId=6&Lang={l}&Regid={g}" for l in (1, 2) for g in (3, 22)]
KEEP = re.compile(r"\b(FDI|foreign direct investment|foreign investment|foreign portfolio|FPI|Press Note|investment policy|GIFT City|IFSCA|sovereign wealth|overseas investment|investment|investors?|foreign)\b", re.I)
H = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Accept": "application/rss+xml, application/xml, */*;q=0.8"}
out, seen = [], set()
for u in URLS:
    try:
        r = requests.get(u, headers=H, timeout=30)
        r.raise_for_status()
        items = list(ET.fromstring(r.content).iter("item"))
        print(u, r.status_code, len(items), "items")
        for it in items:
            g = lambda t: html.unescape(re.sub(r"<[^>]+>", "", (it.findtext(t) or ""))).strip()
            title, link = g("title"), g("link")
            if link and link not in seen and KEEP.search(f"{title} {g('description')}"):
                seen.add(link)
                out.append({"title": title, "link": link, "published": g("pubDate"), "summary": g("description")[:400]})
    except Exception as e:
        print("feed failed", u, e)
# PIB's feed only holds the latest 20 releases per region, so some runs match nothing; that is saved as an empty list.
os.makedirs("data", exist_ok=True)
json.dump(out, open("data/pib_releases.json", "w"), indent=1, ensure_ascii=False)
print("saved", len(out), "releases")
