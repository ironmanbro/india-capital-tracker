import os
import json
import requests
import pandas as pd
from io import StringIO

class DepositoryFPIExtractor:
    def __init__(self):
        self.session = requests.Session()
        self.headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "Referer": "https://www.fpi.nsdl.co.in/"
        }
        self.session.headers.update(self.headers)

    def _clean_and_serialize(self, table_df):
        if isinstance(table_df.columns, pd.MultiIndex):
            table_df.columns = [
                "_".join([str(c).strip() for c in col if "Unnamed" not in str(c)]).strip("_")
                for col in table_df.columns
            ]
        else:
            table_df.columns = [str(col).strip() for col in table_df.columns]
        return table_df.astype(object).fillna("").to_dict(orient="records")

    def fetch_and_clean(self):
        url = "https://www.fpi.nsdl.co.in/web/Reports/ReportDetail.aspx?RepID=1"
        res = self.session.get(url, timeout=15)
        if res.status_code != 200:
            print(f"Failed to fetch NSDL report: status {res.status_code}")
            return
        html_text = res.text
        os.makedirs("data", exist_ok=True)
        try:
            summary_dfs = pd.read_html(StringIO(html_text), match="Eligible Foreign Investors")
            if summary_dfs:
                summary_df = min(summary_dfs, key=len)
                summary_data = self._clean_and_serialize(summary_df)
                with open("data/fpi_debt_utilization_summary.json", "w") as f:
                    json.dump(summary_data, f, indent=2)
                print(f"Saved verified summary metrics ({summary_df.shape[0]} rows)")
        except Exception as e:
            print(f"Error extracting summary table: {e}")
        isin_dfs = pd.read_html(StringIO(html_text), match="Security Description")
        if len(isin_dfs) >= 6:
            isin_tables = {
                "far_gsec_holdings": isin_dfs[2],
                "general_gsec_holdings": isin_dfs[3],
                "sdl_holdings": isin_dfs[4],
                "tbill_holdings": isin_dfs[5]
            }
            for key, df in isin_tables.items():
                cleaned = self._clean_and_serialize(df)
                filepath = os.path.join("data", f"fpi_{key}.json")
                with open(filepath, "w") as f:
                    json.dump(cleaned, f, indent=2)
                print(f"Saved {key} ({df.shape[0]} rows)")
        else:
            print(f"Expected at least 6 ISIN tables matching 'Security Description', found {len(isin_dfs)}.")
        stale_files = [
            "fpi_corporate_bond_holdings.json",
            "fpi_coupon_reinvestment_holdings.json",
            "fpi_gsec_isin_holdings.json",
            "fpi_corporate_isin_holdings.json",
            "fpi_debt_utilization.json"
        ]
        for filename in stale_files:
            path = os.path.join("data", filename)
            if os.path.exists(path):
                os.remove(path)
                print(f"Purged obsolete file: {filename}")

if __name__ == "__main__":
    DepositoryFPIExtractor().fetch_and_clean()
