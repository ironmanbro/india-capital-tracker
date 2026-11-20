import os, sys, unittest
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from deal_match import same_company, match

class Names(unittest.TestCase):
    def test_true_pairs(self):
        for a, b in [("IIFL Capital Services", "IIFL CAPITAL SERVICES LTD"), ("Groww (Billionbrains Garage Ventures)", "Billionbrains Garage Vn L"),
                     ("Meesho", "Meesho Limited"), ("Swiggy", "Swiggy Limited"), ("BSE", "BSE Limited"), ("Clean Max Enviro Energy", "Clean Max Enviro En Sol L"),
                     ("FirstCry (Brainbees Solutions)", "Brainbees Solutions Ltd"), ("Rubicon Research", "Rubicon Research Limited"), ("PhysicsWallah", "Physicswallah Limited")]:
            self.assertTrue(same_company(a, b), (a, b))
    def test_false_pairs(self):
        for a, b in [("IIFL Finance", "IIFL CAPITAL SERVICES LTD"), ("MEIL Group (Megha Engineering and Infrastructures)", "Azad Engineering Limited"),
                     ("Tata Motors", "Tata Steel Limited"), ("Bajaj Finance", "Bajaj Finserv Ltd"), ("HDFC", "HDFC Bank Limited"), ("Adani", "Adani Ports and Special Economic Zone Ltd"),
                     ("ITC", "ITC Hotels Limited"), (None, "Meesho Limited"), ("Meesho", None)]:
            self.assertFalse(same_company(a, b), (a, b))

class Match(unittest.TestCase):
    def test_direction_ignored_date_window_and_closest(self):
        A = [dict(d="2026-11-13", tgt="Meesho Limited", usd=200, ev="exit"), dict(d="2026-11-10", tgt="Meesho Limited", usd=900, ev="exit"),
             dict(d="2026-11-01", tgt="Swiggy Limited", usd=50, ev="entry")]
        C = [dict(d="2026-11-12", tgt="Meesho", ev="entry"), dict(d="2026-11-08", tgt="Swiggy", ev="exit"), dict(d="2026-11-12", tgt="Meesho", ev="fund_launch")]
        self.assertEqual(match(C, A), 1)
        self.assertEqual(C[0]["mk"], {"d": "2026-11-13", "tgt": "Meesho Limited"})
        self.assertNotIn("mk", C[1]); self.assertNotIn("mk", C[2])

if __name__ == "__main__":
    unittest.main()
