import os
import json
import time
import requests

class GDELTInvestmentMonitor:
    def __init__(self):
        self.base_url = "https://api.gdeltproject.org/api/v2/doc/doc"

    def query_india_investments(self, query='India ("venture capital" OR "private equity" OR "foreign investment" OR FDI OR "funding round" OR "raises") sourcelang:english',
                                timespan="7d"):
        """
        Queries GDELT DOC API for global news coverage matching India investments.
        GDELT rules: OR'd terms must be inside (), multi-word terms in quotes, max 1 request per 5 seconds.
        """
        params = {
            "query": query,
            "mode": "artlist",
            "maxrecords": 250,
            "format": "json",
            "sort": "datedesc",
            "timespan": timespan,
        }

        for attempt in range(3):
            try:
                res = requests.get(self.base_url, params=params, timeout=40)
                if res.status_code == 429:  # rate limited: wait and retry
                    time.sleep(6)
                    continue
                if res.status_code == 200:
                    try:
                        data = res.json()
                    except ValueError:  # GDELT sends plain-text errors with HTTP 200
                        print(f"GDELT rejected the query: {res.text[:200]}")
                        return []
                    articles = list({a["url"]: a for a in data.get("articles", [])}.values())  # GDELT repeats syndicated URLs
                    print(f"Successfully retrieved {len(articles)} investment articles from GDELT.")
                    return articles
                print(f"GDELT API returned status code {res.status_code}")
                return []
            except Exception as e:
                print(f"Error querying GDELT API: {e}")
                time.sleep(6)
        return []

    def save_json(self, data, filename):
        os.makedirs("data", exist_ok=True)
        filepath = os.path.join("data", filename)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"Saved: {filepath}")

if __name__ == "__main__":
    monitor = GDELTInvestmentMonitor()
    gdelt_articles = monitor.query_india_investments()
    if gdelt_articles:
        monitor.save_json(gdelt_articles, "gdelt_india_investments.json")
