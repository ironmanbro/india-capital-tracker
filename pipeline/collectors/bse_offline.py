import os, json, glob
import pandas as pd

class BSEOfflineLoader:
    def __init__(self, raw_dir="downloads"):
        self.raw_dir = raw_dir
        os.makedirs("data", exist_ok=True)

    def process_deal_file(self, file_path, output_filename):
        if not os.path.exists(file_path):
            print(f"File not found: {file_path}")
            return False
        try:
            if file_path.lower().endswith(".csv"):
                df = pd.read_csv(file_path)
            elif file_path.lower().endswith((".xls", ".xlsx")):
                df = pd.read_excel(file_path)
            else:
                print(f"Unsupported file format: {file_path}")
                return False
            df.columns = [str(c).strip() for c in df.columns]
            df = df.dropna(how="all")
            records = df.astype(object).fillna("").to_dict(orient="records")
            out = os.path.join("data", output_filename)
            with open(out, "w", encoding="utf-8") as f:
                json.dump(records, f, indent=2, ensure_ascii=False, default=str)  # default=str: Excel dates
            print(f"Processed {len(records)} records from {file_path} -> {out}")
            return True
        except Exception as e:
            print(f"Error processing {file_path}: {e}")
            return False

    def run(self):
        """Picks any file in raw_dir with 'bulk' or 'block' in its name."""
        ok = False
        for kind in ("bulk", "block"):
            files = [f for f in glob.glob(os.path.join(self.raw_dir, "*"))
                     if kind in os.path.basename(f).lower()]
            if not files:
                print(f"No {kind} file in {self.raw_dir}/")
                continue
            newest = max(files, key=os.path.getmtime)
            ok = self.process_deal_file(newest, f"bse_{kind}_deals.json") or ok
        return ok

if __name__ == "__main__":
    BSEOfflineLoader().run()
