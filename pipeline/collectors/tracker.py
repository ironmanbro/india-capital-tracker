import os
import json
import requests

class ExtendedNSETracker:
    def __init__(self):
        self.session = requests.Session()
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
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

    def fetch_fii_dii_activity(self):
        url = "https://www.nseindia.com/api/fiidiiTradeReact"
        try:
            res = self.session.get(url, timeout=10)
            if res.status_code == 200:
                data = res.json()
                print("Successfully fetched FII/DII activity records.")
                return data
            else:
                print(f"FII/DII fetch failed with status: {res.status_code}")
        except Exception as e:
            print(f"Error fetching FII/DII activity: {e}")
        return []

    def fetch_bulk_block_deals(self):
        url = "https://www.nseindia.com/api/snapshot-capital-market-largedeal"
        try:
            res = self.session.get(url, timeout=10)
            if res.status_code == 200:
                data = res.json()
                print("Successfully fetched Large/Bulk/Block deals snapshot.")
                return data
            else:
                print(f"Bulk/Block deals fetch failed with status: {res.status_code}")
        except Exception as e:
            print(f"Error fetching Bulk/Block deals: {e}")
        return {}

    def save_json(self, data, filename):
        os.makedirs("data", exist_ok=True)
        filepath = os.path.join("data", filename)
        with open(filepath, "w") as f:
            json.dump(data, f, indent=2)
        print(f"Saved: {filepath}")

if __name__ == "__main__":
    tracker = ExtendedNSETracker()
    fii_dii = tracker.fetch_fii_dii_activity()
    if fii_dii:
        tracker.save_json(fii_dii, "fii_dii_daily.json")
    deals = tracker.fetch_bulk_block_deals()
    if deals:
        tracker.save_json(deals, "bulk_block_deals.json")
