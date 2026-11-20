import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import deal_quality as Q

class Role(unittest.TestCase):
    def test_intermediaries(self):
        for n in ["SOCIETE GENERALE", "BNP PARIBAS ARBITRAGE", "MORGAN STANLEY ASIA SINGAPORE PTE", "GOLDMAN SACHS BANK EUROPE SE - ODI", "CITADEL SECURITIES SINGAPORE PTE LIMITED"]:
            self.assertEqual(Q.role(n), "intermediary", n)
    def test_domestic(self):
        for n in ["NATIONAL PENSION SYSTEM (NPS) TRUST", "HDFC Life", "SBI Mutual Fund", "PPFAS Asset Management"]:
            self.assertEqual(Q.role(n), "domestic", n)
    def test_real_foreign_investors_stay_foreign(self):
        for n in ["BLACKROCK EMERGING MARKETS FUND INC", "Goldman Sachs", "GOLDMAN SACHS FUNDS - GOLDMAN SACHS INDIA EQUITY PORTFOLIO", "NORGES BANK ON ACCOUNT OF THE GOVERNMENT PENSION FUND GLOBAL", "GHISALLO MASTER FUND LP", "KKR", None]:
            self.assertEqual(Q.role(n), "foreign", n)

class Stage(unittest.TestCase):
    def test_buckets(self):
        self.assertEqual([Q.bucket(s) for s in ["completed", "agreed", "talks", "plan", "pledge", None]], ["done", "announced", "announced", "pledge", "pledge", "announced"])

class Amount(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(Q.headline_usd_m("EQT to invest $50 billion in India"), [50000])
        self.assertAlmostEqual(Q.headline_usd_m("plans ₹2,000 crore plant", 94)[0], 212.77, places=1)
        self.assertAlmostEqual(Q.headline_usd_m("Rs 2.5 lakh crore demand", 100)[0], 25000)
    def test_ok_and_flag(self):
        self.assertIsNone(Q.amount_check(7200, "Amazon to put $7 billion into India"))
        self.assertIsNone(Q.amount_check(None, "Amazon to put $7 billion into India"))
        self.assertIsNone(Q.amount_check(500, "No amount in this headline"))
        self.assertIn("7,000", Q.amount_check(48000, "Amazon to put $7 billion into India"))
    def test_tenfold_rupee_slip_is_corrected(self):
        r = Q.apply(dict(inv="Saint-Gobain", g="C", stage="plan", usd=21, t="Saint-Gobain plans ₹2,000 crore investment"), 94)
        self.assertEqual((r["usd"], r["usd0"], r.get("fix"), "chk" in r, r["sg"]), (212.8, 21, 1, False, "pledge"))
    def test_other_mismatch_only_flagged(self):
        r = Q.apply(dict(inv="Amazon", g="C", stage="plan", usd=48000, t="Amazon to put $7 billion into India"), 94)
        self.assertEqual((r["usd"], "chk" in r, "usd0" in r), (48000, True, False))
    def test_exchange_rows_never_amount_checked(self):
        r = Q.apply(dict(inv="SOCIETE GENERALE", g="A", stage="completed", usd=27, t="bought shares worth ₹237.6 cr (bulk deal)"), 94)
        self.assertEqual((r["role"], r["sg"], "chk" in r), ("intermediary", "done", False))

if __name__ == "__main__":
    unittest.main()
