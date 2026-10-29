import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import load_supabase as L, nse_master as n
sys.path.insert(0, os.path.dirname(__file__))
from test_nse_master import client, FakeResp
from test_shp_parser import doc


class Rec:
    def __init__(s): s.calls = []
    def __call__(s, req, timeout=None):
        s.calls.append((req.full_url, json.loads(req.data), req.headers)); return FakeResp(b"", 201)


class T(unittest.TestCase):
    def build(self, d):
        rows = n.normalise([{"symbol": "AAA", "date": "2025-06-30", "xbrl": "https://nsearchives.nseindia.com/a.xml"},
                            {"symbol": "AAA", "date": "2025-09-30", "xbrl": "https://nsearchives.nseindia.com/b.xml"}], "equities")
        mp = os.path.join(d, "m.csv")
        n.download_all(client([FakeResp(doc("2025-06-30", 3.0, 3000)), FakeResp(doc("2025-09-30", 4.2, 4200))]), rows, mp, d)
        n.parse_and_export(mp, os.path.join(d, "p"))
        return os.path.join(d, "p")

    def test_load_types_and_upsert(self):
        with tempfile.TemporaryDirectory() as d:
            p, rec = self.build(d), Rec()
            counts = L.load(p, "https://x.supabase.co/", "KEY", opener=rec)
            self.assertEqual(counts, {"nse_filings": 2, "nse_holdings": 2, "nse_ownership_changes": 1})
            url, rows, h = next(c for c in rec.calls if "nse_holdings" in c[0])
            self.assertIn("on_conflict=symbol,reporting_period,investor_name,source_document_hash", url)
            self.assertEqual((rows[0]["percentage_held"], rows[0]["foreign_flag"], rows[0]["filing_date"]), (3.0, True, None))
            ch = next(c for c in rec.calls if "changes" in c[0])[1][0]
            self.assertAlmostEqual(ch["pct_point_change"], 1.2); self.assertEqual(ch["shares_change"], 1200.0)
            self.assertEqual((ch["previous_source_url"], ch["latest_source_url"]), ("https://nsearchives.nseindia.com/a.xml", "https://nsearchives.nseindia.com/b.xml"))

    def test_dry_run_makes_no_calls(self):
        with tempfile.TemporaryDirectory() as d:
            rec = Rec(); L.load(self.build(d), "https://x", "K", dry_run=True, opener=rec); self.assertEqual(rec.calls, [])

    def test_error_hides_key(self):
        import urllib.error, io
        def bad(req, timeout=None): raise urllib.error.HTTPError(req.full_url, 401, "", {}, io.BytesIO(b"denied"))
        with self.assertRaises(RuntimeError) as e: L.post("https://x", "SECRETKEY", "t", "c", [{}], bad)
        self.assertNotIn("SECRETKEY", str(e.exception))


unittest.main() if __name__ == "__main__" else None
