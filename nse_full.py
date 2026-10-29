import requests
import json
from datetime import datetime, timezone

def fetch_and_clean_nse_shareholdings(index_type="equities"):
    url = f"https://www.nseindia.com/api/corporate-share-holdings-master?index={index_type}"
    
    session = requests.Session()
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate",
        "Referer": "https://www.nseindia.com/",
        "Connection": "keep-alive"
    }
    
    try:
        session.get("https://www.nseindia.com", headers=headers, timeout=10)
        response = session.get(url, headers=headers, timeout=15)
        
        if response.status_code == 200:
            raw_data = response.json()
            print(f"Successfully fetched {len(raw_data)} raw records for {index_type}.")
            
            deduped_records = {}
            current_timestamp = datetime.now(timezone.utc).isoformat()
            
            for item in raw_data:
                # Fallback to symbol if ISIN is null/missing (prevents dropping major stocks)
                key = item.get("isin") or item.get("symbol")
                if not key:
                    continue
                
                date_str = item.get("date", "")
                try:
                    filing_date = datetime.strptime(date_str, "%d-%b-%Y")
                except ValueError:
                    filing_date = datetime.min
                
                # Check revision status ('Revised' vs '-')
                revised_status = str(item.get("revisedStatus", "")).strip().lower()
                is_revised = 1 if revised_status in ["yes", "true", "revised"] else 0
                
                if key not in deduped_records:
                    deduped_records[key] = (filing_date, is_revised, item)
                else:
                    existing_date, existing_revised, _ = deduped_records[key]
                    
                    # Compare chronological date first, then tie-break with revision status
                    if filing_date > existing_date:
                        deduped_records[key] = (filing_date, is_revised, item)
                    elif filing_date == existing_date:
                        if is_revised > existing_revised:
                            deduped_records[key] = (filing_date, is_revised, item)
            
            cleaned_list = []
            for key, (_, _, item) in deduped_records.items():
                cleaned_list.append({
                    "symbol": item.get("symbol"),
                    "name": item.get("name"),
                    "isin": item.get("isin"),  # Preserves exact ISIN value (even if null)
                    "date": item.get("date"),
                    "revised_status": item.get("revisedStatus"),
                    "submission_type": item.get("typeOfSubmission"),
                    "promoter_holding": item.get("pr_and_prgrp"),
                    "public_holding": item.get("public_val"),
                    "updated_at": current_timestamp
                })
            
            print(f"Processed and deduped down to {len(cleaned_list)} unique corporate records.")
            
            with open("nse_shareholding_cleaned.json", "w") as f:
                json.dump(cleaned_list, f, indent=2)
                
            return cleaned_list
        else:
            print(f"Failed with status code: {response.status_code}")
            return None
            
    except Exception as e:
        print(f"Error connecting to NSE: {e}")
        return None

if __name__ == "__main__":
    master_data = fetch_and_clean_nse_shareholdings("equities")
