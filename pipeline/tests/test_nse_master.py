import json, os, sys, tempfile, unittest, urllib.error
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import nse_master as n

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "master_sample.json")


class FakeResp:
    def __init__(s, body, status=200): s.body, s.status, s.headers = body, status, {"Content-Type": "x"}
    def read(s, n=-1): return s.body[:n] if n >= 0 else s.body
    def __enter__(s): return s
    def __exit__(s, *a): pass


class FakeOpener:
    def __init__(s, script): s.script, s.calls = list(script), 0
    def open(s, req, timeout=None):
        s.calls += 1
        r = s.script.pop(0)
        if isinstance(r, Exception): raise r
        return r


def client(script): return n.Client(interval=0, opener=FakeOpener(script), sleep=lambda x: None)


class T(unittest.TestCase):
    def rows(self): return n.normalise(json.load(open(FIX)), "equities")

    def test_normalise_keeps_missing_null(self):
        r = self.rows()
        self.assertEqual(r[0]["symbol"], "AAA"); self.assertIsNone(r[0]["isin"]); self.assertIsNone(r[2]["url"])

    def test_dedupe(self):
        u, _ = n.dedupe(self.rows()); self.assertEqual(len(u), 2)

    def test_overlap(self):
        _, ov = n.dedupe(self.rows() + n.normalise([{"symbol": "AAA", "xbrl": "u"}], "sme")); self.assertEqual(ov, ["AAA"])

    def test_retry_then_success(self):
        c = client([urllib.error.HTTPError("https://x", 503, "", {}, None), FakeResp(b"ok")])
        self.assertEqual(c.get("https://x")[0], 200); self.assertEqual(c.opener.calls, 2)

    def test_no_retry_on_404(self):
        c = client([urllib.error.HTTPError("https://x", 404, "", {}, None)]); self.assertEqual(c.get("https://x")[0], 404); self.assertEqual(c.opener.calls, 1)

    def test_size_limit(self):
        self.assertIsNone(client([FakeResp(b"x" * 20)]).get("https://x", max_bytes=10)[2])

    def test_master_invalid_json(self):
        with tempfile.TemporaryDirectory() as d:
            recs, m = n.fetch_master(client([FakeResp(b"ok"), FakeResp(b"<html>")]), "equities", d)
            self.assertEqual(recs, []); self.assertIn("invalid json", m["error"])

    def test_master_snapshot(self):
        with tempfile.TemporaryDirectory() as d:
            recs, m = n.fetch_master(client([FakeResp(b"ok"), FakeResp(open(FIX, "rb").read())]), "equities", d)
            self.assertEqual(m["records"], 3); self.assertTrue(os.path.exists(m["snapshot"]))

    def test_download_resume_and_validation(self):
        rows, _ = n.dedupe(self.rows())
        with tempfile.TemporaryDirectory() as d:
            mp = os.path.join(d, "m.csv")
            n.download_all(client([FakeResp(b"<xml/>")]), rows, mp, d)
            m = n.load_manifest(mp); self.assertEqual(m[rows[0]["url"]]["download_status"], "ok")
            c2 = client([]); n.download_all(c2, rows, mp, d); self.assertEqual(c2.opener.calls, 0)  # resumed: nothing refetched

    def test_bad_signature_and_host(self):
        rows = n.normalise([{"symbol": "A", "xbrl": "https://nsearchives.nseindia.com/a"}, {"symbol": "B", "xbrl": "https://evil.com/b"}], "equities")
        with tempfile.TemporaryDirectory() as d:
            m = n.download_all(client([FakeResp(b"\x00\x01binary")]), rows, os.path.join(d, "m.csv"), d)
            self.assertEqual(m["https://nsearchives.nseindia.com/a"]["error"], "unrecognised file signature")
            self.assertEqual(m["https://evil.com/b"]["download_status"], "rejected_host")

    def test_safe_name(self): self.assertNotIn("/", n.safe_name("../../etc/passwd"))


unittest.main() if __name__ == "__main__" else None
