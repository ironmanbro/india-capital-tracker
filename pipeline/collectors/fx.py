"""USD/INR daily reference rates from the European Central Bank, via the free Frankfurter API (no key)."""
import json, os, datetime as dt, requests

today = dt.date.today()
r = requests.get(f"https://api.frankfurter.dev/v1/{today - dt.timedelta(days=120)}..{today}", params={"base": "USD", "symbols": "INR"},
                 headers={"User-Agent": "IndianCapitalTracker"}, timeout=30)
r.raise_for_status()
rows = [{"date": d, "usd_inr": v["INR"]} for d, v in sorted(r.json()["rates"].items())]
assert rows, "no rates"
os.makedirs("data", exist_ok=True)
json.dump(rows, open("data/fx_usd_inr.json", "w"), indent=1)
print("saved", len(rows), "rates, latest", rows[-1])
