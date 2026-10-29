import os, sys, unittest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import shp_parser as p


def doc(period, pct, shares, pct2=None):
    extra = ""
    if pct2 is not None:
        extra = f'<in:NameOfTheShareholder contextRef="D_ForeignPortfolioInvestors_Context2">Gamma Fund</in:NameOfTheShareholder><in:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="ForeignPortfolioInvestors_Context2">{pct2}</in:ShareholdingAsAPercentageOfTotalNumberOfShares>'
    return f"""<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:in="x" xmlns:xbrldi="http://xbrl.org/2006/xbrldi">
<xbrli:context id="c1"><xbrli:period><xbrli:instant>{period}</xbrli:instant></xbrli:period></xbrli:context>
<in:Symbol contextRef="c1">AAA</in:Symbol><in:NameOfTheCompany contextRef="c1">Alpha (SYNTHETIC)</in:NameOfTheCompany>
<in:NameOfTheShareholder contextRef="D_ForeignPortfolioInvestors_Context1">Beta Fund</in:NameOfTheShareholder>
<in:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="ForeignPortfolioInvestors_Context1">{pct}</in:ShareholdingAsAPercentageOfTotalNumberOfShares>
<in:NumberOfFullyPaidUpEquityShares contextRef="ForeignPortfolioInvestors_Context1">{shares}</in:NumberOfFullyPaidUpEquityShares>
<in:NameOfTheShareholder contextRef="D_Individuals_Context3">Raj Kumar</in:NameOfTheShareholder>
<in:ShareholdingAsAPercentageOfTotalNumberOfShares contextRef="Individuals_Context3">0.5</in:ShareholdingAsAPercentageOfTotalNumberOfShares>{extra}</xbrli:xbrl>""".encode()


class T(unittest.TestCase):
    def test_parse(self):
        f = p.parse_shp(doc("2025-06-30", 3.0, "3,000"))
        self.assertEqual((f["symbol"], f["period_end"], len(f["rows"])), ("AAA", "2025-06-30", 1))  # 0.5% filtered
        r = f["rows"][0]
        self.assertEqual((r["holder"], r["pct"], r["shares"], r["foreign"]), ("Beta Fund", 3.0, 3000.0, True))

    def test_doctype_rejected(self):
        with self.assertRaises(ValueError): p.parse_shp(b'<!DOCTYPE x [<!ENTITY a "b">]><x/>')

    def test_changes(self):
        a, b = p.parse_shp(doc("2025-06-30", 3.0, 3000)), p.parse_shp(doc("2025-09-30", 4.2, 4200, pct2=1.5))
        ch = {c["holder"]: c for c in p.compute_changes([b, a])}  # order-independent
        self.assertAlmostEqual(ch["Beta Fund"]["pct_point_change"], 1.2); self.assertEqual(ch["Beta Fund"]["shares_change"], 1200)
        self.assertEqual(ch["Gamma Fund"]["status"], "entered_list"); self.assertIsNone(ch["Gamma Fund"]["pct_point_change"])

    def test_single_period_no_changes(self):
        self.assertEqual(p.compute_changes([p.parse_shp(doc("2025-06-30", 3.0, 1))]), [])


unittest.main() if __name__ == "__main__" else None
