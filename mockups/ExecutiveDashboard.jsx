// India Capital Tracker: executive dashboard mockup (single React component, mock data only).
const { useState, useMemo } = React;

/* ---------- theme ---------- */
const C = {
  bg: "#0b1220", panel: "#111a2e", panel2: "#16213a", line: "rgba(148,163,184,.16)", ink: "#e2e8f0", muted: "#94a3b8",
  in: "#10b981", out: "#ef4444", violet: "#8b5cf6", blue: "#3b82f6", amber: "#f59e0b",
};
const FX = 88; // ₹ per US$, for the small rupee brackets

/* ---------- mock data (seeded, so it is the same on every load) ---------- */
function rng(seed) { return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const R = rng(20261031);
const pick = (a) => a[Math.floor(R() * a.length)];

const INVESTORS = [
  { name: "Temasek", type: "SWF", country: "Singapore", aum: 288, sectors: ["Financial services", "Technology", "Consumer"] },
  { name: "GIC", type: "SWF", country: "Singapore", aum: 770, sectors: ["Infrastructure", "Real estate", "Financial services"] },
  { name: "ADIA", type: "SWF", country: "UAE", aum: 990, sectors: ["Infrastructure", "Energy", "Consumer"] },
  { name: "Norges Bank IM", type: "SWF", country: "Norway", aum: 1700, sectors: ["Financial services", "Industrials"] },
  { name: "Brookfield", type: "PE/VC", country: "Canada", aum: 900, sectors: ["Infrastructure", "Real estate", "Energy"] },
  { name: "KKR", type: "PE/VC", country: "USA", aum: 600, sectors: ["Healthcare", "Technology", "Consumer"] },
  { name: "Blackstone", type: "PE/VC", country: "USA", aum: 1100, sectors: ["Real estate", "Financial services"] },
  { name: "General Atlantic", type: "PE/VC", country: "USA", aum: 100, sectors: ["Technology", "Healthcare"] },
  { name: "BlackRock", type: "FPI", country: "USA", aum: 10600, sectors: ["Financial services", "Technology", "Energy"] },
  { name: "Vanguard", type: "FPI", country: "USA", aum: 9300, sectors: ["Financial services", "Industrials", "Consumer"] },
  { name: "Goldman Sachs AM", type: "FPI", country: "USA", aum: 2800, sectors: ["Financial services", "Technology"] },
  { name: "Capital Group", type: "FPI", country: "USA", aum: 2600, sectors: ["Consumer", "Healthcare"] },
  { name: "CPP Investments", type: "Pension", country: "Canada", aum: 400, sectors: ["Infrastructure", "Financial services"] },
  { name: "CDPQ", type: "Pension", country: "Canada", aum: 300, sectors: ["Infrastructure", "Real estate"] },
  { name: "Mitsubishi UFJ", type: "Strategic", country: "Japan", aum: 2300, sectors: ["Financial services"] },
  { name: "Sumitomo Mitsui", type: "Strategic", country: "Japan", aum: 2000, sectors: ["Financial services", "Infrastructure"] },
];
const COMPANIES = [
  { n: "HDFC Bank", s: "Financial services" }, { n: "Reliance Retail", s: "Consumer" }, { n: "Zomato", s: "Technology" },
  { n: "Adani Ports", s: "Infrastructure" }, { n: "Apollo Hospitals", s: "Healthcare" }, { n: "Tata Power", s: "Energy" },
  { n: "Embassy REIT", s: "Real estate" }, { n: "Larsen & Toubro", s: "Industrials" }, { n: "Bajaj Finance", s: "Financial services" },
  { n: "Swiggy", s: "Technology" },
];
const STAGES = ["Completed", "Agreed", "In talks"];
const CATS = ["Investment", "Exit", "Fund launch", "Jurisdiction move"];
const SECTORS = [...new Set(COMPANIES.map((c) => c.s))];

const DEALS = Array.from({ length: 56 }, (_, i) => {
  const inv = pick(INVESTORS), co = pick(COMPANIES);
  const roll = R(), cat = roll < 0.6 ? "Investment" : roll < 0.82 ? "Exit" : roll < 0.94 ? "Fund launch" : "Jurisdiction move";
  const amt = Math.round(20 + R() ** 2 * 1400);
  const verb = cat === "Investment" ? pick(["buys stake in", "invests in", "picks up shares of"]) : cat === "Exit" ? pick(["sells stake in", "exits", "offloads shares of"]) : null;
  return {
    id: i, days: Math.floor(R() * 360), mins: Math.floor(R() * 1440), inv, co, cat, amt, stage: pick(STAGES), src: pick(["Exchange filing", "Company release", "News"]),
    title: verb ? `${inv.name} ${verb} ${co.n}` : cat === "Fund launch" ? `${inv.name} launches India-focused fund at GIFT City` : `${inv.name} moves India fund domicile to GIFT City`,
  };
}).sort((a, b) => a.days - b.days || a.mins - b.mins);

const DAILY = Array.from({ length: 120 }, (_, i) => {
  const d = new Date(2026, 9, 30 - (119 - i));
  return { date: d, eq: Math.round((R() - 0.55) * 900 + Math.sin(i / 9) * 250), debt: Math.round((R() - 0.4) * 420) };
});
const FDI = Array.from({ length: 17 }, (_, i) => ({ fy: 2010 + i, v: Math.round((14 + i * 2.3 + R() * 9 - (i === 11 ? 8 : 0)) * 10) / 10 }));
const EXCH_SEG = ["Cash", "Index futures", "Index options", "Stock futures", "Stock options"];
const EXCH = Array.from({ length: 20 }, (_, d) => EXCH_SEG.map((seg, k) => {
  const base = seg === "Cash" ? 1400 : seg === "Index options" ? 5200 : seg === "Index futures" ? 1800 : 1100;
  const buy = Math.round(base * (0.7 + R() * 0.6)), sell = Math.round(base * (0.7 + R() * 0.6));
  return { d, seg, buy, sell, net: buy - sell };
}));
const REG = Array.from({ length: 64 }, (_, i) => {
  const isGift = i % 4 === 0, cat = R() < 0.72 ? "Cat I" : "Cat II";
  const n = pick(["Meridian", "Northbridge", "Sapphire", "Kestrel", "Lakeshore", "Orion", "Atlas", "Helios", "Summit", "Cobalt", "Harbor", "Pinnacle"]);
  const k = pick(["Global Fund", "Capital Partners", "Opportunities Fund", "Asset Management", "Master Fund", "Investment Trust"]);
  return {
    id: i, name: `${n} ${k}${isGift ? " IFSC" : ""}`, reg: `${isGift ? "IFSCA/FME" : "INSG"}${String(100000 + i * 137).slice(1)}`, type: isGift ? "GIFT City" : "FPI",
    cat, country: isGift ? "India IFSC" : pick(["USA", "Singapore", "Luxembourg", "Ireland", "UK", "Mauritius", "Canada"]),
    status: R() < 0.82 ? "Active" : R() < 0.6 ? "Surrendered" : "Suspended", date: new Date(2016 + Math.floor(R() * 10), Math.floor(R() * 12), 1 + Math.floor(R() * 27)),
  };
});

/* ---------- helpers ---------- */
const usd = (m) => { const a = Math.abs(m), s = m < 0 ? "−" : ""; return a >= 1000 ? `${s}$${(a / 1000).toFixed(a >= 10000 ? 1 : 2)}bn` : `${s}$${Math.round(a)}m`; };
const inr = (m) => { const cr = Math.abs(m) * FX / 10; return cr >= 1e5 ? `₹${(cr / 1e5).toFixed(1)} lakh cr` : `₹${Math.round(cr).toLocaleString("en-IN")} cr`; };
const Money = ({ m, big }) => <span>{usd(m)} <small style={{ color: C.muted, fontSize: big ? ".5em" : ".78em", fontWeight: 400 }}>({inr(m)})</small></span>;
const ago = (d) => (d.days === 0 ? `${Math.max(1, Math.floor(d.mins / 60))}h ago` : d.days < 30 ? `${d.days}d ago` : `${Math.round(d.days / 30)}mo ago`);
const stageColor = { Completed: C.in, Agreed: C.blue, "In talks": C.amber };
const catColor = { Investment: C.in, Exit: C.out, "Fund launch": C.violet, "Jurisdiction move": C.blue };
const typeColor = { SWF: C.blue, "PE/VC": C.violet, FPI: C.in, Pension: C.amber, Strategic: "#06b6d4" };

const Pill = ({ color, children, on, onClick, title }) => (
  <button onClick={onClick} title={title} style={{ background: on === false ? "transparent" : `${color}22`, color: on === false ? C.muted : color, border: `1px solid ${on === false ? C.line : color + "66"}`, borderRadius: 999, padding: "4px 11px", fontSize: 12, fontWeight: 600, cursor: onClick ? "pointer" : "default" }}>{children}</button>
);
const Card = ({ title, sub, right, children, style }) => (
  <div style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 14, padding: 16, ...style }}>
    {(title || right) && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
      <div><div style={{ fontWeight: 700, fontSize: 15 }}>{title}</div>{sub && <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{sub}</div>}</div>{right}</div>}
    {children}
  </div>
);
const Seg = ({ value, options, onChange }) => (
  <div style={{ display: "inline-flex", background: C.bg, border: `1px solid ${C.line}`, borderRadius: 9, padding: 2 }}>
    {options.map(([v, l]) => <button key={v} onClick={() => onChange(v)} style={{ border: 0, borderRadius: 7, padding: "5px 11px", fontSize: 12, fontWeight: 600, cursor: "pointer", background: value === v ? C.panel2 : "transparent", color: value === v ? C.ink : C.muted }}>{l}</button>)}
  </div>
);
const Input = (p) => <input {...p} style={{ background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 11px", fontSize: 13, outline: "none", minWidth: 0, ...p.style }} />;
const Select = ({ value, onChange, options }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} style={{ background: C.bg, color: C.ink, border: `1px solid ${C.line}`, borderRadius: 9, padding: "8px 10px", fontSize: 13 }}>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

/* ---------- small SVG charts ---------- */
function Spark({ values, color }) {
  const W = 120, H = 34, mn = Math.min(...values), mx = Math.max(...values), x = (i) => (i / (values.length - 1)) * W, y = (v) => H - 3 - ((v - mn) / (mx - mn || 1)) * (H - 6);
  return <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="34" preserveAspectRatio="none"><polyline fill="none" stroke={color} strokeWidth="2" points={values.map((v, i) => `${x(i)},${y(v)}`).join(" ")} /></svg>;
}
// Round tick values (1, 2 or 5 times a power of ten); the scale is widened to the outer ticks.
function nice(lo, hi) {
  const raw = (Math.max(0, hi) - Math.min(0, lo)) / 4 || 1, pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((x) => x >= raw);
  const mn = Math.floor(Math.min(0, lo) / step) * step, mx = Math.ceil(Math.max(0, hi) / step) * step, ticks = [];
  for (let v = mn; v <= mx + step / 2; v += step) ticks.push(v);
  return { mn, mx, ticks };
}
// Grouped bars (one or two series) with an optional line on a right-hand axis.
function Chart({ labels, series, line, height = 240, fmt = (v) => v, lineFmt = (v) => v, mode = "both" }) {
  const W = 860, H = height, L = 54, Rr = line && mode !== "bars" ? 54 : 10, T = 12, B = 26;
  const vals = series.flatMap((s) => s.values), sc = nice(Math.min(...vals), Math.max(...vals)), mn = sc.mn, mx = sc.mx, span = mx - mn || 1;
  const y = (v) => T + ((mx - v) / span) * (H - T - B);
  const ls = line ? nice(Math.min(...line.values), Math.max(...line.values)) : { mn: 0, mx: 1, ticks: [] }, lmn = ls.mn, lmx = ls.mx, lspan = lmx - lmn || 1;
  const y2 = (v) => T + ((lmx - v) / lspan) * (H - T - B);
  const step = (W - L - Rr) / labels.length, k = series.length, bw = Math.max(1.5, Math.min(18, (step - 2) / k));
  const every = Math.ceil(labels.length / 12);
  const ticks = sc.ticks;
  const showBars = mode !== "line", showLine = line && mode !== "bars";
  const cx = (i) => L + i * step + step / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - Rr} y1={y(t)} y2={y(t)} stroke={C.line} /><text x={L - 6} y={y(t) + 4} fill={C.muted} fontSize="10" textAnchor="end">{fmt(t)}</text></g>)}
      <line x1={L} x2={W - Rr} y1={y(0)} y2={y(0)} stroke="rgba(148,163,184,.4)" />
      {showBars && labels.map((_, i) => series.map((s, j) => {
        const v = s.values[i], h = Math.abs(y(v) - y(0)), x = cx(i) - (k * bw) / 2 + j * bw;
        return <rect key={`${i}-${j}`} x={x} y={v >= 0 ? y(v) : y(0)} width={bw - 0.5} height={Math.max(1, h)} rx="1.5" fill={s.color || (v >= 0 ? C.in : C.out)} opacity={s.color ? (v >= 0 ? 1 : 0.55) : 1} />;
      }))}
      {showLine && <><polyline fill="none" stroke={C.violet} strokeWidth="2" strokeLinejoin="round" points={labels.map((_, i) => `${cx(i)},${y2(line.values[i])}`).join(" ")} />
        {mode === "both" && ls.ticks.map((t, i) => <text key={i} x={W - Rr + 6} y={y2(t) + 4} fill={C.violet} fontSize="10">{lineFmt(t)}</text>)}</>}
      {labels.map((l, i) => i % every === 0 && <text key={i} x={cx(i)} y={H - 8} fill={C.muted} fontSize="10" textAnchor="middle">{l}</text>)}
    </svg>
  );
}

/* ---------- the dashboard ---------- */
function ExecutiveDashboard() {
  const TABS = ["Overview", "Live Feed", "Investors", "Network Graph", "Macro Flow", "Exchange & NSDL", "FPI Directory"];
  const [tab, setTab] = useState("Overview");
  const [period, setPeriod] = useState("90D");
  const [srcOn, setSrcOn] = useState({ SWF: true, "PE/VC": true, FPI: true, Pension: true, Strategic: true });
  const [stageOn, setStageOn] = useState({ Completed: true, Agreed: true, "In talks": true });
  const PD = { "7D": 7, "30D": 30, "90D": 90, YTD: 303, "1Y": 365 };

  const deals = useMemo(() => DEALS.filter((d) => d.days < PD[period] && srcOn[d.inv.type] && stageOn[d.stage]), [period, srcOn, stageOn]);
  const flowDays = Math.min(120, PD[period]);
  const daily = DAILY.slice(-flowDays);

  return (
    <div style={{ background: C.bg, color: C.ink, minHeight: "100vh", font: "14px/1.45 Inter, system-ui, -apple-system, 'Segoe UI', sans-serif", paddingBottom: 40 }}>
      {/* top bar */}
      <div style={{ position: "sticky", top: 0, zIndex: 20, background: "rgba(11,18,32,.94)", backdropFilter: "blur(10px)", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "12px 18px", display: "flex", flexWrap: "wrap", gap: 14, alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: ".14em", color: C.muted, fontWeight: 700 }}>INDIA CAPITAL TRACKER</div>
            <div style={{ fontSize: 20, fontWeight: 800 }}>Executive dashboard <span style={{ fontSize: 11, color: C.amber, border: `1px solid ${C.amber}66`, borderRadius: 6, padding: "1px 6px", marginLeft: 6, verticalAlign: "middle" }}>MOCK DATA</span></div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
            <div><div style={lbl}>Period</div><Seg value={period} onChange={setPeriod} options={Object.keys(PD).map((p) => [p, p])} /></div>
            <div><div style={lbl}>Source</div><div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{Object.keys(srcOn).map((s) => <Pill key={s} color={typeColor[s]} on={srcOn[s]} onClick={() => setSrcOn({ ...srcOn, [s]: !srcOn[s] })}>{s}</Pill>)}</div></div>
            <div><div style={lbl}>Deal stage</div><div style={{ display: "flex", gap: 5 }}>{STAGES.map((s) => <Pill key={s} color={stageColor[s]} on={stageOn[s]} onClick={() => setStageOn({ ...stageOn, [s]: !stageOn[s] })}>{s}</Pill>)}</div></div>
            <div style={{ color: C.muted, fontSize: 12, textAlign: "right" }}>Built by <b style={{ color: C.ink }}>Kishan Singhania</b></div>
          </div>
        </div>
        <div style={{ maxWidth: 1240, margin: "0 auto", padding: "0 18px", display: "flex", gap: 2, overflowX: "auto" }}>
          {TABS.map((t) => <button key={t} onClick={() => setTab(t)} style={{ background: "none", border: 0, borderBottom: `2px solid ${tab === t ? C.violet : "transparent"}`, color: tab === t ? C.ink : C.muted, padding: "10px 14px", fontWeight: 600, fontSize: 13, cursor: "pointer", whiteSpace: "nowrap" }}>{t}</button>)}
        </div>
      </div>

      <div style={{ maxWidth: 1240, margin: "0 auto", padding: "18px" }}>
        {tab === "Overview" && <Overview deals={deals} daily={daily} />}
        {tab === "Live Feed" && <Feed deals={deals} />}
        {tab === "Investors" && <Investors deals={deals} />}
        {tab === "Network Graph" && <Network deals={deals} />}
        {tab === "Macro Flow" && <Macro daily={daily} />}
        {tab === "Exchange & NSDL" && <Exchange period={period} />}
        {tab === "FPI Directory" && <Directory />}
      </div>
    </div>
  );
}
const lbl = { fontSize: 10, letterSpacing: ".1em", textTransform: "uppercase", color: C.muted, marginBottom: 3, fontWeight: 700 };

/* ---------- 1. overview ---------- */
function Overview({ deals, daily }) {
  const [sel, setSel] = useState(null);
  const inflow = deals.filter((d) => d.cat === "Investment").reduce((a, d) => a + d.amt, 0);
  const outflow = deals.filter((d) => d.cat === "Exit").reduce((a, d) => a + d.amt, 0);
  const net = daily.reduce((a, d) => a + d.eq + d.debt, 0);
  let run = 0; const cum = daily.map((d) => (run += d.eq + d.debt));
  const byCountry = Object.entries(deals.filter((d) => d.cat === "Investment").reduce((m, d) => ((m[d.inv.country] = (m[d.inv.country] || 0) + d.amt), m), {})).sort((a, b) => b[1] - a[1]);
  const top = Math.max(1, ...byCountry.map((x) => x[1]));
  const big = [...deals].sort((a, b) => b.amt - a.amt).slice(0, 5);
  const news = deals.slice(0, 7), cur = sel != null ? deals.find((d) => d.id === sel) || news[0] : news[0];
  const metric = (label, val, color, spark) => <Card><div style={{ color: C.muted, fontSize: 12, fontWeight: 600 }}>{label}</div><div style={{ fontSize: 24, fontWeight: 800, color, margin: "4px 0" }}>{val}</div><Spark values={spark} color={color} /></Card>;
  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
      {metric("Net FPI flow", <Money m={net} big />, net >= 0 ? C.in : C.out, cum)}
      {metric("Capital in (deals)", <Money m={inflow} big />, C.in, daily.map((d) => Math.max(0, d.eq)))}
      {metric("Capital out (exits)", <Money m={outflow} big />, C.out, daily.map((d) => Math.abs(Math.min(0, d.eq))))}
      {metric("Deals tracked", deals.length, C.violet, daily.map((d, i) => (i * 7 + d.debt) % 50))}
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 12, marginTop: 12 }}>
      <Card title="Capital sources by country" sub="Investment deals in the period, by the investor's home country">
        {byCountry.length === 0 && <div style={{ color: C.muted }}>No deals match the filters.</div>}
        {byCountry.map(([c, v]) => <div key={c} style={{ margin: "9px 0" }}><div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}><span>{c}</span><span style={{ color: C.muted }}><Money m={v} /></span></div>
          <div style={{ height: 7, background: C.bg, borderRadius: 4, marginTop: 4 }}><div style={{ width: `${(v / top) * 100}%`, height: 7, borderRadius: 4, background: `linear-gradient(90deg,${C.violet},${C.blue})` }} /></div></div>)}
      </Card>
      <Card title="Biggest deals" sub="Largest in the period">
        {big.map((d) => <div key={d.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "9px 0", borderTop: `1px solid ${C.line}` }}>
          <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: 13 }}>{d.title}</div><div style={{ marginTop: 4, display: "flex", gap: 6 }}><Pill color={catColor[d.cat]}>{d.cat}</Pill><Pill color={stageColor[d.stage]}>{d.stage}</Pill></div></div>
          <div style={{ fontWeight: 700, color: d.cat === "Exit" ? C.out : C.in, whiteSpace: "nowrap", textAlign: "right" }}><Money m={d.amt} /></div></div>)}
      </Card>
    </div>
    <Card title="Live news" sub="Pick a story to read its detail" style={{ marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.2fr)", gap: 14 }} className="split">
        <div>{news.map((d) => <button key={d.id} onClick={() => setSel(d.id)} style={{ display: "block", width: "100%", textAlign: "left", background: cur && cur.id === d.id ? C.panel2 : "transparent", border: 0, borderLeft: `3px solid ${catColor[d.cat]}`, color: C.ink, padding: "9px 11px", marginBottom: 4, borderRadius: 6, cursor: "pointer" }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{d.title}</div><div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>{d.src} · {ago(d)}</div></button>)}
          {!news.length && <div style={{ color: C.muted }}>No stories match the filters.</div>}</div>
        {cur && <div style={{ background: C.bg, borderRadius: 12, padding: 16, border: `1px solid ${C.line}` }}>
          <div style={{ display: "flex", gap: 6 }}><Pill color={catColor[cur.cat]}>{cur.cat}</Pill><Pill color={stageColor[cur.stage]}>{cur.stage}</Pill><Pill color={typeColor[cur.inv.type]}>{cur.inv.type}</Pill></div>
          <div style={{ fontSize: 18, fontWeight: 700, margin: "10px 0 6px" }}>{cur.title}</div>
          <div style={{ color: C.muted, fontSize: 13 }}>{cur.inv.name} ({cur.inv.country}) · {cur.co.n} · {cur.co.s}</div>
          <div style={{ fontSize: 22, fontWeight: 800, margin: "10px 0", color: cur.cat === "Exit" ? C.out : C.in }}><Money m={cur.amt} big /></div>
          <div style={{ color: C.muted, fontSize: 12 }}>Source: {cur.src} · {ago(cur)} · Illustrative mock record</div></div>}
      </div>
    </Card>
  </>);
}

/* ---------- 2. live feed ---------- */
function Feed({ deals }) {
  const [q, setQ] = useState(""), [cat, setCat] = useState(null);
  const rows = deals.filter((d) => (!cat || d.cat === cat) && (!q || `${d.title} ${d.co.n} ${d.inv.name}`.toLowerCase().includes(q.toLowerCase())));
  return (<Card title="Live feed" sub={`${rows.length} stories`} right={<Input placeholder="Search stories…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 220 }} />}>
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}><Pill color={C.muted} on={!cat} onClick={() => setCat(null)}>All</Pill>{CATS.map((c) => <Pill key={c} color={catColor[c]} on={cat === c} onClick={() => setCat(cat === c ? null : c)}>{c}</Pill>)}</div>
    {rows.slice(0, 30).map((d) => <div key={d.id} style={{ display: "grid", gridTemplateColumns: "6px 1fr auto", gap: 12, padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
      <div style={{ background: catColor[d.cat], borderRadius: 3 }} />
      <div><div style={{ fontWeight: 600 }}>{d.title}</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}><Pill color={catColor[d.cat]}>{d.cat}</Pill><Pill color={stageColor[d.stage]}>{d.stage}</Pill><span style={{ color: C.muted, fontSize: 12, alignSelf: "center" }}>{d.src} · {d.co.s}</span></div></div>
      <div style={{ textAlign: "right" }}><div style={{ fontWeight: 700, color: d.cat === "Exit" ? C.out : C.in }}>{d.cat === "Fund launch" || d.cat === "Jurisdiction move" ? "" : <Money m={d.amt} />}</div><div style={{ color: C.muted, fontSize: 11 }}>{ago(d)}</div></div></div>)}
    {!rows.length && <div style={{ color: C.muted, padding: 20 }}>No stories match.</div>}
  </Card>);
}

/* ---------- 3. investors ---------- */
function Investors({ deals }) {
  const [view, setView] = useState("grid"), [q, setQ] = useState(""), [type, setType] = useState("All");
  const rows = INVESTORS.map((i) => ({ ...i, n: deals.filter((d) => d.inv.name === i.name).length, vol: deals.filter((d) => d.inv.name === i.name).reduce((a, d) => a + d.amt, 0) }))
    .filter((i) => (type === "All" || i.type === type) && (!q || i.name.toLowerCase().includes(q.toLowerCase()))).sort((a, b) => b.vol - a.vol);
  const aum = (v) => (v >= 1000 ? `$${(v / 1000).toFixed(1)}tn` : `$${v}bn`);
  return (<Card title="Investors" sub={`${rows.length} of ${INVESTORS.length} shown · deal counts follow the filters above`} right={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <Input placeholder="Search investors…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 170 }} /><Select value={type} onChange={setType} options={["All", ...Object.keys(typeColor)]} /><Seg value={view} onChange={setView} options={[["grid", "Grid"], ["list", "List"]]} /></div>}>
    {view === "grid" ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 12 }}>
      {rows.map((i) => <div key={i.name} style={{ background: C.panel2, border: `1px solid ${C.line}`, borderRadius: 12, padding: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between" }}><b style={{ fontSize: 15 }}>{i.name}</b><Pill color={typeColor[i.type]}>{i.type}</Pill></div>
        <div style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>{i.country} · AUM {aum(i.aum)}</div>
        <div style={{ display: "flex", gap: 14, margin: "10px 0" }}><div><div style={{ fontSize: 20, fontWeight: 800 }}>{i.n}</div><div style={{ color: C.muted, fontSize: 11 }}>deals</div></div><div><div style={{ fontSize: 20, fontWeight: 800, color: C.in }}>{usd(i.vol)}</div><div style={{ color: C.muted, fontSize: 11 }}>deal value</div></div></div>
        <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>{i.sectors.map((s) => <span key={s} style={{ fontSize: 11, color: C.muted, background: C.bg, borderRadius: 6, padding: "2px 7px" }}>{s}</span>)}</div></div>)}
    </div> : <table style={tbl}><thead><tr>{["Investor", "Type", "Country", "AUM", "Deals", "Deal value", "Sectors"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead><tbody>
      {rows.map((i) => <tr key={i.name}><td style={td}><b>{i.name}</b></td><td style={td}><Pill color={typeColor[i.type]}>{i.type}</Pill></td><td style={td}>{i.country}</td><td style={td}>{aum(i.aum)}</td><td style={td}>{i.n}</td><td style={{ ...td, color: C.in }}>{usd(i.vol)}</td><td style={{ ...td, color: C.muted }}>{i.sectors.join(", ")}</td></tr>)}</tbody></table>}
    {!rows.length && <div style={{ color: C.muted, padding: 20 }}>No investors match.</div>}
  </Card>);
}
const tbl = { width: "100%", borderCollapse: "collapse", fontSize: 13 };
const th = { textAlign: "left", color: C.muted, fontWeight: 600, fontSize: 12, padding: "8px 10px", borderBottom: `1px solid ${C.line}`, whiteSpace: "nowrap" };
const td = { padding: "9px 10px", borderBottom: `1px solid ${C.line}` };

/* ---------- 4. network graph ---------- */
function Network({ deals }) {
  const [focus, setFocus] = useState(null);
  const cols = useMemo(() => {
    const tally = (f) => { const m = {}; deals.filter((d) => d.cat === "Investment").forEach((d) => { const k = f(d); m[k] = (m[k] || 0) + d.amt; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
    return [
      { title: "Capital source", key: "country", items: tally((d) => d.inv.country).slice(0, 5) },
      { title: "Lead investor", key: "inv", items: tally((d) => d.inv.name).slice(0, 7) },
      { title: "Sector", key: "sector", items: tally((d) => d.co.s).slice(0, 6) },
      { title: "Portfolio company", key: "co", items: tally((d) => d.co.n).slice(0, 8) },
    ];
  }, [deals]);
  const W = 900, H = 440, X = [90, 320, 560, 810];
  const pos = {};
  cols.forEach((c, ci) => c.items.forEach(([n], i) => { pos[`${c.key}:${n}`] = { x: X[ci], y: 50 + (i * (H - 80)) / Math.max(1, c.items.length - 1 || 1) + (c.items.length === 1 ? 150 : 0) }; }));
  const edges = {};
  deals.filter((d) => d.cat === "Investment").forEach((d) => {
    [["country:" + d.inv.country, "inv:" + d.inv.name], ["inv:" + d.inv.name, "sector:" + d.co.s], ["sector:" + d.co.s, "co:" + d.co.n]].forEach(([a, b]) => { if (pos[a] && pos[b]) { const k = a + "|" + b; edges[k] = (edges[k] || 0) + d.amt; } });
  });
  const ev = Object.entries(edges), mx = Math.max(1, ...ev.map((e) => e[1]));
  const linked = (id) => { if (!focus) return true; if (id === focus) return true; return ev.some(([k]) => { const [a, b] = k.split("|"); return (a === focus && b === id) || (b === focus && a === id); }); };
  return (<Card title="Capital network" sub="Source → lead investor → sector → company. Line width = deal value. Click a node to isolate its links." right={focus && <Pill color={C.violet} onClick={() => setFocus(null)}>Clear ✕</Pill>}>
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: "block" }}>
      {cols.map((c, i) => <text key={c.title} x={X[i]} y="18" fill={C.muted} fontSize="11" fontWeight="700" textAnchor="middle" style={{ textTransform: "uppercase", letterSpacing: ".08em" }}>{c.title}</text>)}
      {ev.map(([k, v]) => { const [a, b] = k.split("|"), p = pos[a], q = pos[b], on = !focus || a === focus || b === focus;
        return <path key={k} d={`M${p.x + 6},${p.y} C${(p.x + q.x) / 2},${p.y} ${(p.x + q.x) / 2},${q.y} ${q.x - 6},${q.y}`} fill="none" stroke={C.violet} strokeOpacity={on ? 0.55 : 0.07} strokeWidth={1 + (v / mx) * 7} />; })}
      {cols.map((c) => c.items.map(([n, v]) => { const id = `${c.key}:${n}`, p = pos[id], on = linked(id);
        return <g key={id} onClick={() => setFocus(focus === id ? null : id)} style={{ cursor: "pointer" }} opacity={on ? 1 : 0.25}>
          <circle cx={p.x} cy={p.y} r={5 + (v / mx) * 4} fill={focus === id ? C.violet : C.blue} stroke={C.bg} strokeWidth="2" />
          <text x={p.x} y={p.y - 12} fill={C.ink} fontSize="11" fontWeight="600" textAnchor="middle">{n}</text>
          <title>{n}: {usd(v)}</title></g>; }))}
    </svg>
    {!ev.length && <div style={{ color: C.muted, padding: 20 }}>No investment deals match the filters.</div>}
  </Card>);
}

/* ---------- 5. macro flow ---------- */
function Macro({ daily }) {
  const [mode, setMode] = useState("both"), [mode2, setMode2] = useState("both");
  let run = 0; const cum = daily.map((d) => (run += d.eq + d.debt));
  const fy = FDI, yoy = fy.map((d, i) => (i ? ((d.v - fy[i - 1].v) / fy[i - 1].v) * 100 : 0));
  const lab = (d) => `${d.date.getDate()} ${d.date.toLocaleString("en", { month: "short" })}`;
  const tot = (k) => daily.reduce((a, d) => a + d[k], 0);
  return (<>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 12, marginBottom: 12 }}>
      {[["Equity net", tot("eq")], ["Debt net", tot("debt")], ["All segments", tot("eq") + tot("debt")]].map(([l, v]) => <Card key={l}><div style={{ color: C.muted, fontSize: 12 }}>{l}, period</div><div style={{ fontSize: 22, fontWeight: 800, color: v >= 0 ? C.in : C.out }}><Money m={v} big /></div></Card>)}
    </div>
    <Card title="Daily FPI net flows: equity vs debt" sub="US$ million per trading day. The line is the running total on the right-hand axis." right={<Seg value={mode} onChange={setMode} options={[["bars", "Bars"], ["line", "Line"], ["both", "Both"]]} />}>
      <div style={{ display: "flex", gap: 14, fontSize: 12, color: C.muted, marginBottom: 4 }}><span><i style={dot(C.in)} /> Equity</span><span><i style={dot(C.blue)} /> Debt</span><span><i style={dot(C.violet)} /> Running total</span></div>
      <Chart labels={daily.map(lab)} series={[{ values: daily.map((d) => d.eq), color: C.in }, { values: daily.map((d) => d.debt), color: C.blue }]} line={{ values: cum }} mode={mode} fmt={(v) => `${Math.round(v)}`} lineFmt={(v) => usd(v)} height={260} />
    </Card>
    <Card title="DPIIT annual FDI equity inflow" sub="US$ billion by financial year. The line is the change on the previous year (right axis)." style={{ marginTop: 12 }} right={<Seg value={mode2} onChange={setMode2} options={[["bars", "Bars"], ["line", "Line"], ["both", "Both"]]} />}>
      <Chart labels={fy.map((d) => `FY${String(d.fy + 1).slice(2)}`)} series={[{ values: fy.map((d) => d.v), color: C.in }]} line={{ values: yoy }} mode={mode2} fmt={(v) => `$${Math.round(v)}bn`} lineFmt={(v) => `${Math.round(v)}%`} height={240} />
    </Card>
  </>);
}
const dot = (c) => ({ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: c, marginRight: 5 });

/* ---------- 6. exchange & nsdl ---------- */
function Exchange({ period }) {
  const [who, setWho] = useState("FII/FPI"), [seg, setSeg] = useState("All");
  const days = Math.min(20, { "7D": 5, "30D": 20, "90D": 20, YTD: 20, "1Y": 20 }[period]);
  const rows = EXCH.slice(-days).flatMap((day) => day).filter((r) => seg === "All" || r.seg === seg);
  const mult = who === "FII/FPI" ? 1 : who === "DII" ? 0.8 : 0.5;
  const date = (d) => new Date(2026, 9, 30 - (19 - d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });
  const sum = (k) => rows.reduce((a, r) => a + r[k] * mult, 0);
  return (<Card title="Daily exchange activity" sub="Buy and sell by segment, US$ million (NSE cash and derivatives; NSDL custody flows shown on Macro Flow)" right={<div style={{ display: "flex", gap: 8 }}><Select value={who} onChange={setWho} options={["FII/FPI", "DII", "Proprietary"]} /><Select value={seg} onChange={setSeg} options={["All", ...EXCH_SEG]} /></div>}>
    <div style={{ display: "flex", gap: 22, margin: "4px 0 10px", flexWrap: "wrap" }}>{[["Buy", sum("buy"), C.in], ["Sell", sum("sell"), C.out], ["Net", sum("buy") - sum("sell"), sum("buy") >= sum("sell") ? C.in : C.out]].map(([l, v, c]) => <div key={l}><div style={{ color: C.muted, fontSize: 12 }}>{l}</div><div style={{ fontSize: 20, fontWeight: 800, color: c }}><Money m={v} big /></div></div>)}</div>
    <div style={{ maxHeight: 460, overflow: "auto" }}><table style={tbl}><thead><tr>{["Date", "Segment", "Buy", "Sell", "Net"].map((h, i) => <th key={h} style={{ ...th, textAlign: i > 1 ? "right" : "left", position: "sticky", top: 0, background: C.panel }}>{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => { const n = (r.buy - r.sell) * mult; return <tr key={i}><td style={td}>{date(r.d)}</td><td style={td}>{r.seg}</td><td style={{ ...td, textAlign: "right" }}>{usd(r.buy * mult)}</td><td style={{ ...td, textAlign: "right" }}>{usd(r.sell * mult)}</td><td style={{ ...td, textAlign: "right", fontWeight: 700, color: n >= 0 ? C.in : C.out }}>{usd(n)}</td></tr>; })}</tbody></table></div>
  </Card>);
}

/* ---------- 7. fpi directory ---------- */
function Directory() {
  const [q, setQ] = useState(""), [cat, setCat] = useState("All"), [type, setType] = useState("All"), [status, setStatus] = useState("All"), [page, setPage] = useState(0);
  const rows = REG.filter((r) => (cat === "All" || r.cat === cat) && (type === "All" || r.type === type) && (status === "All" || r.status === status) && (!q || `${r.name} ${r.reg} ${r.country}`.toLowerCase().includes(q.toLowerCase())));
  const per = 12, pages = Math.max(1, Math.ceil(rows.length / per)), p = Math.min(page, pages - 1);
  const sc = { Active: C.in, Surrendered: C.muted, Suspended: C.out };
  const reset = (f) => (v) => { f(v); setPage(0); };
  return (<Card title="Registry of FPIs and GIFT City entities" sub={`${rows.length} matches`} right={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <Input placeholder="Search name, number or country…" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} style={{ width: 230 }} />
    <Select value={type} onChange={reset(setType)} options={["All", "FPI", "GIFT City"]} /><Select value={cat} onChange={reset(setCat)} options={["All", "Cat I", "Cat II"]} /><Select value={status} onChange={reset(setStatus)} options={["All", "Active", "Surrendered", "Suspended"]} /></div>}>
    <div style={{ overflowX: "auto" }}><table style={tbl}><thead><tr>{["Name", "Registration", "Type", "Category", "Country", "Registered", "Status"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
      <tbody>{rows.slice(p * per, p * per + per).map((r) => <tr key={r.id}><td style={td}><b>{r.name}</b></td><td style={{ ...td, color: C.muted }}>{r.reg}</td><td style={td}><Pill color={r.type === "FPI" ? C.blue : C.violet}>{r.type}</Pill></td><td style={td}>{r.cat}</td><td style={td}>{r.country}</td><td style={td}>{r.date.toISOString().slice(0, 10)}</td>
        <td style={td}><span style={{ color: sc[r.status], fontWeight: 600 }}>● {r.status}</span></td></tr>)}</tbody></table></div>
    {!rows.length && <div style={{ color: C.muted, padding: 20 }}>No registrations match.</div>}
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 12, color: C.muted, fontSize: 12 }}><span>Page {p + 1} of {pages}</span>
      <span style={{ display: "flex", gap: 6 }}><Pill color={C.muted} onClick={() => setPage(Math.max(0, p - 1))}>← Prev</Pill><Pill color={C.muted} onClick={() => setPage(Math.min(pages - 1, p + 1))}>Next →</Pill></span></div>
  </Card>);
}
