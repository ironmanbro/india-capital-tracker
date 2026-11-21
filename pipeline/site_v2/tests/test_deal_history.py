import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from deal_history import label

SHP = [dict(company="IIFL CAPITAL SERVICES LIMITED", period_end="2026-11-04", holder="Fih Mauritius Investments Ltd", pct=38.05),
       dict(company="Meesho Ltd", period_end="2026-12-31", holder="SOCIETE GENERALE", pct=1.2)]           # filed after the deal
BUYS = [dict(d="2026-08-04", inv="FIDELITY FUNDS - INDIA FOCUS FUND", tgt="Meesho Limited"),
        dict(d="2026-11-13", inv="FIDELITY FUNDS - INDIA FOCUS FUND", tgt="Meesho Limited")]

class Label(unittest.TestCase):
    def run_one(self, **r):
        r = dict(dict(g="A", ev="entry"), **r); label([r], SHP, BUYS); return r
    def test_prior_filing_means_added(self):
        r = self.run_one(d="2026-11-19", inv="FIH MAURITIUS INVESTMENTS LTD", tgt="IIFL CAPITAL SERVICES LTD")
        self.assertEqual(r["pos"], "added"); self.assertIn("38.05%", r["posn"])
    def test_earlier_exchange_buy_means_added(self):
        r = self.run_one(d="2026-11-13", inv="FIDELITY FUNDS - INDIA FOCUS FUND", tgt="Meesho Limited")
        self.assertEqual((r["pos"], r["posn"]), ("added", "bought on the exchange on 2026-08-04"))
    def test_no_record_is_first_seen(self):
        r = self.run_one(d="2026-08-04", inv="FIDELITY FUNDS - INDIA FOCUS FUND", tgt="Meesho Limited")   # same-day buy is not earlier
        self.assertEqual(r["pos"], "first")
    def test_filing_after_the_deal_does_not_count(self):
        self.assertEqual(self.run_one(d="2026-11-13", inv="SOCIETE GENERALE", tgt="Meesho Limited")["pos"], "first")
    def test_other_company_does_not_count(self):
        self.assertEqual(self.run_one(d="2026-11-19", inv="FIH MAURITIUS INVESTMENTS LTD", tgt="IIFL FINANCE LTD")["pos"], "first")
    def test_sells_and_news_rows_untouched(self):
        r = dict(g="A", ev="exit", d="2026-11-19", inv="FIH MAURITIUS INVESTMENTS LTD", tgt="IIFL CAPITAL SERVICES LTD"); c = dict(g="C", ev="entry", d="2026-11-19", inv="x", tgt="y")
        label([r, c], SHP, BUYS); self.assertNotIn("pos", r); self.assertNotIn("pos", c)

if __name__ == "__main__":
    unittest.main()
