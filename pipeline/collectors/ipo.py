import os
import json
import requests

class AdvancedNSEMetrics:
    def __init__(self):
        self.session = requests.Session()
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "Referer": "https://www.nseindia.com/"
        }
        self.session.headers.update(self.headers)
        self._handshake()

    def _handshake(self):
        try:
            self.session.get("https://www.nseindia.com", headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"}, timeout=10)
            print("Session handshake executed.")
        except Exception as e:
            print(f"Handshake connection note: {e}")

    def fetch_ipo_current_issues(self):
        url = "https://www.nseindia.com/api/ipo-current-issue"
        try:
            res = self.session.get(url, timeout=10)
            if res.status_code == 200:
                data = res.json()
                print(f"Successfully fetched {len(data) if isinstance(data, list) else 'live'} current IPO issues.")
                return data
            else:
                print(f"IPO current issue fetch failed with status: {res.status_code}")
        except Exception as e:
            print(f"Error fetching IPO current issues: {e}")
        return []

    def fetch_ipo_upcoming_issues(self):
        url = "https://www.nseindia.com/api/all-upcoming-issues?category=ipo"
        try:
            res = self.session.get(url, timeout=10)
            if res.status_code == 200:
                data = res.json()
                print("Successfully fetched upcoming IPO issues.")
                return data
            else:
                print(f"Upcoming IPO fetch failed with status: {res.status_code}")
        except Exception as e:
            print(f"Error fetching upcoming IPOs: {e}")
        return []

    def save_json(self, data, filename):
        os.makedirs("data", exist_ok=True)
        filepath = os.path.join("data", filename)
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)
        print(f"Saved: {filepath}")

if __name__ == "__main__":
    metrics = AdvancedNSEMetrics()
    current_ipos = metrics.fetch_ipo_current_issues()
    if current_ipos:
        metrics.save_json(current_ipos, "ipo_current_issue.json")
    upcoming_ipos = metrics.fetch_ipo_upcoming_issues()
    if upcoming_ipos:
        metrics.save_json(upcoming_ipos, "ipo_upcoming_issues.json")
