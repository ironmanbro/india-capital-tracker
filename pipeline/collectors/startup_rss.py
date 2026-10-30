import os
import re
import json
import html
import requests
import xml.etree.ElementTree as ET

class StartupMediaRSSAggregator:
    def __init__(self):
        # Verified working feeds. Dropped: vccircle (no RSS exists, 404), business_wire (403 to scripts).
        self.feeds = {
            "entrackr": "https://entrackr.com/rss",
            "inc42": "https://inc42.com/feed/",
            "yourstory": "https://yourstory.com/feed",
            "economic_times_startups": "https://economictimes.indiatimes.com/small-biz/startups/rssfeeds/11993034.cms",
            "pr_newswire_apac": "https://www.prnewswire.com/apac/rss/news-releases-list.rss",
        }
        # Wire services are global: only keep items that mention India
        self.india_only = {"pr_newswire_apac"}
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/rss+xml, application/xml, text/xml, */*;q=0.8",
            "Accept-Encoding": "gzip, deflate",
        }
        # word-boundary match: the pasted substring test hit "people", "experience" (pe), "service" (vc)...
        # deal verbs only: "crore"/"million" alone also match revenue and results stories
        self.kw = re.compile(r"\b(funding|raised?|raises|seed|series [a-f]|pre-series|venture|acqui\w+|private equity|"
                             r"invests?|invested|stake|led by|backed by|buyout|IPO)\b", re.I)
        self.india = re.compile(r"\b(india\w*|₹|rs\.?|crore|lakh|mumbai|bengaluru|delhi)\b", re.I)

    @staticmethod
    def _text(el, tag):
        x = el.find(tag)
        return html.unescape(re.sub(r"<[^>]+>", "", x.text or "")).strip() if x is not None else ""

    def fetch_all_feeds(self):
        out, seen = [], set()
        for source, url in self.feeds.items():
            print(f"Fetching RSS feed: {source}...")
            try:
                r = requests.get(url, headers=self.headers, timeout=30)
                r.raise_for_status()
                items = ET.fromstring(r.content).iter("item")
            except Exception as e:
                print(f"Error parsing feed {source}: {e}")
                continue
            for it in items:
                title, link = self._text(it, "title"), self._text(it, "link")
                summary = self._text(it, "description")
                blob = f"{title} {summary}"
                if link in seen or not self.kw.search(blob):
                    continue
                if source in self.india_only and not self.india.search(blob):
                    continue
                seen.add(link)
                out.append({"source": source, "title": title, "link": link, "published": self._text(it, "pubDate"),
                            "summary": summary[:500]})
        print(f"Successfully aggregated {len(out)} relevant funding/deal articles across feeds.")
        return out

    def save_json(self, data, filename):
        os.makedirs("data", exist_ok=True)
        filepath = os.path.join("data", filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"Saved: {filepath}")

if __name__ == "__main__":
    aggregator = StartupMediaRSSAggregator()
    deals = aggregator.fetch_all_feeds()
    if deals:
        aggregator.save_json(deals, "startup_funding_news.json")
