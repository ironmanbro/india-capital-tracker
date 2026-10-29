import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))
import bse_master as b, nse_master as n
from test_nse_master import client, FakeResp

FM = {"company_name": ["cn"], "symbol": ["sym"], "isin": ["isin"], "reporting_period": ["qtr"], "url": ["link"]}


def cfg(d, **kw):
    p = os.path.join(d, "c.json")
    json.dump({"enabled": True, "listing_url": "https://api.bseindia.com/x", "allowed_hosts": ["bseindia.com"], "field_map": FM, **kw}, open(p, "w"))
    return p


class T(unittest.TestCase):
    def test_disabled_without_config(self):
        with self.assertRaises(b.BseDisabled): b.load_config("/nonexistent.json")

    def test_incomplete_or_http_config(self):
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(b.BseDisabled): b.load_config(cfg(d, enabled=False))
            with self.assertRaises(b.BseDisabled): b.load_config(cfg(d, listing_url="http://x"))
            with self.assertRaises(b.BseDisabled): b.load_config(cfg(d, field_map={}))

    def test_normalise_unmapped_stay_null(self):
        r = b.normalise([{"cn": "Alpha", "sym": "AAA", "link": "https://www.bseindia.com/a.xml"}], FM)[0]
        self.assertEqual((r["exchange"], r["company_name"], r["isin"], r["doc_id"]), ("BSE", "Alpha", None, None))

    def test_isin_matching_no_name_guess(self):
        nse = n.normalise([{"symbol": "AAA", "name": "Alpha", "isin": "INE000A01010"}, {"symbol": "ZZZ", "name": "Alpha"}], "equities")
        bse = b.normalise([{"cn": "Alpha", "isin": "ine000a01010"}], FM)
        canon, un = b.match_by_isin(nse, bse)
        self.assertEqual(sorted(canon["INE000A01010"]["exchanges"]), ["BSE", "NSE"]); self.assertEqual(len(un), 1)

    def test_run_downloads_only_allowed_hosts(self):
        listing = json.dumps([{"cn": "A", "sym": "A", "qtr": "2025-06", "link": "https://www.bseindia.com/a.xml"},
                              {"cn": "B", "sym": "B", "qtr": "2025-06", "link": "https://evil.com/b.xml"}]).encode()
        with tempfile.TemporaryDirectory() as d:
            res = b.run(d, config_path=cfg(d), client=client([FakeResp(listing), FakeResp(b"<xml/>")]))
            self.assertEqual((res["master"]["records"], res["filing_refs"], res["downloaded_ok"]), (2, 2, 1))
            m = n.load_manifest(os.path.join(d, "manifests/bse_download_manifest.csv"))
            self.assertEqual(m["https://evil.com/b.xml"]["download_status"], "rejected_host")


unittest.main() if __name__ == "__main__" else None
