import os
import sys
import json
import requests

class MCARegistryClient:
    def __init__(self, api_key=None, auth_token=None):
        # Using a structured B2B financial API gateway (e.g., Sandbox.co.in or similar)
        # to query MCA Master Data reliably without breaking against V3 portal captchas.
        self.base_url = "https://api.sandbox.co.in/kyc/mca"
        self.api_key = api_key or os.getenv("MCA_API_KEY", "")
        self.auth_token = auth_token or os.getenv("MCA_AUTH_TOKEN", "")
        if not (self.api_key and self.auth_token):
            raise SystemExit("Set MCA_API_KEY and MCA_AUTH_TOKEN first (paid gateway account needed).")

        self.session = requests.Session()
        self.headers = {
            "x-api-key": self.api_key,
            "Authorization": self.auth_token,
            "Content-Type": "application/json"
        }
        self.session.headers.update(self.headers)

    def search_company(self, query):
        """
        Search for a company by its CIN, LLPIN, or Company Name.
        """
        url = f"{self.base_url}/company/master-data/search"
        params = {"company_name": query} if not query.startswith(("U", "L")) else {"cin": query}

        try:
            res = self.session.get(url, params=params, timeout=15)
            if res.status_code == 200:
                data = res.json()
                records = data.get("data", {}).get("records", [])
                print(f"Found {len(records)} matching records for query: {query}")
                return records
            else:
                print(f"MCA API search failed with status code {res.status_code}: {res.text}")
        except Exception as e:
            print(f"Error querying MCA registry: {e}")
        return []

    def save_json(self, data, filename):
        os.makedirs("data", exist_ok=True)
        path = os.path.join("data", filename)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"Saved: {path}")

if __name__ == "__main__":
    # usage: python mca.py "RELIANCE INDUSTRIES LIMITED" L17110MH1973PLC019786
    client = MCARegistryClient()
    results = {q: client.search_company(q) for q in sys.argv[1:]}
    if any(results.values()):
        client.save_json(results, "mca_company_master.json")
