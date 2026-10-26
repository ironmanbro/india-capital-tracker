// DPIIT quarterly FDI fact sheet: equity inflow by country, sector and state for three financial
// years, plus annual totals since 2000-01. The PDF's text comes out of order, so each top-10 row is
// named by matching its cumulative amount to the full lists in the annexes.

const amt = (s: string) => parseFloat(s.replace(/,/g, ""));
// Shorter names for the charts.
const RENAME: Record<string, string> = {
  "U.S.A": "USA", "U.S.A.": "USA", "Netherland": "Netherlands", "Services Sector": "Services",
  "Projects": "Real estate development", "Computer Software & Hardware": "Software & hardware",
  "Automobile Industry": "Automobiles", "Construction (Infrastructure) Activities": "Infrastructure construction",
  "Non-conventional Energy": "Renewable energy", "Chemicals (Other Than Fertilizers)": "Chemicals",
  "Drugs & Pharmaceuticals": "Pharmaceuticals",
};
// All-caps names become title case; short ones like UAE are acronyms and stay as they are.
const titleCase = (s: string) => s === s.toUpperCase() && /[A-Z]{5}/.test(s)
  ? s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bAnd\b/g, "and") : s;
const clean = (s: string) => { const t = s.trim().replace(/\s*\*+$/, ""); return RENAME[t] || titleCase(t); };

export type DpiitRow = { kind: string; name: string; fy: string; inr_cr: number | null; usd_m: number };

export function parseFactSheet(pages: string[]) {
  const all = pages.join("\n");
  const ed = /Updated up to ([A-Za-z]+),?\s*(\d{4})/.exec(all);
  if (!ed) throw new Error("not a DPIIT FDI fact sheet");
  const fys = [...new Set([...all.matchAll(/(\d{4}-\d{2})\s*\n\s*\(April\s*[-–]\s*March\)/g)].map((m) => m[1]))].slice(0, 3);
  if (fys.length !== 3) throw new Error(`expected 3 financial years in the top tables, found ${fys.length}`);

  const annex: Record<string, { name: string; inr: number }[]> = { country: [], sector: [], state: [] };
  let cur: string | null = null;
  for (const p of pages) {
    if (/SECTOR-WISE FDI EQUITY INFLOW\s*\nFROM/.test(p)) cur = "sector";
    else if (/STATE-WISE FDI EQUITY INFLOW\s*\nFROM/.test(p)) cur = "state";
    else if (/COUNTRY-WISE FDI EQUITY INFLOW/.test(p)) cur = "country";
    if (!cur) continue;
    for (const m of p.matchAll(/^([A-Za-z][^\n\d]*?)\s+([\d,]+(?:\.\d+)?)\s+([\d,]+(?:\.\d+)?)\s*$/gm)) {
      if (!/total|rbi|awaited|not indicated/i.test(m[1])) annex[cur].push({ name: clean(m[1]), inr: amt(m[2]) });
    }
  }

  const rows: DpiitRow[] = [];
  for (const m of all.matchAll(/Rupees Crores ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+)\s*\nUSD Million ([\d,]+) ([\d,]+) ([\d,]+) ([\d,]+)/g)) {
    const cum = amt(m[4]);
    let hit: { kind: string; name: string } | null = null;
    for (const kind of ["country", "sector", "state"]) {
      const a = annex[kind].find((x) => Math.abs(x.inr - cum) <= 1);
      if (a) { hit = { kind, name: a.name }; break; }
    }
    if (!hit) continue; // the all-countries total
    fys.forEach((fy, i) => rows.push({ ...hit!, fy, inr_cr: amt(m[1 + i]), usd_m: amt(m[5 + i]) }));
    rows.push({ ...hit, fy: "cumulative", inr_cr: cum, usd_m: amt(m[8]) });
  }
  // Annual US$ million (international definition): equity, unincorporated equity, re-invested earnings, other capital, total.
  for (const m of all.matchAll(/^\d+\s+(\d{4}-\d{2})(?:\s*\(P\))?\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s+([\d,]+)\s/gm)) {
    rows.push({ kind: "annual", name: "Equity", fy: m[1], inr_cr: null, usd_m: amt(m[2]) + amt(m[3]) });
    rows.push({ kind: "annual", name: "Total FDI", fy: m[1], inr_cr: null, usd_m: amt(m[6]) });
  }
  for (const k of ["country", "sector", "state", "annual"]) {
    const n = new Set(rows.filter((r) => r.kind === k).map((r) => r.name)).size;
    if (n < (k === "annual" ? 2 : 5)) throw new Error(`only ${n} ${k} rows matched`);
  }
  return { edition: `${ed[1]} ${ed[2]}`, fys, rows };
}
