// Flows: FPI investment from NSDL and FDI / FPI totals from the RBI Bulletin.
//   POST /functions/v1/flows          (both)
//   POST /functions/v1/flows?only=nsdl
//   POST /functions/v1/flows?only=rbi
//   POST /functions/v1/flows?only=dpiit&u=<DPIIT fact sheet PDF>   (quarterly; the PDF link changes each edition)
// Requires header x-ingest-key = app_secrets.ingest_key. NSDL refuses requests from outside
// India, so callers send x-region: ap-south-1 (Mumbai).

import { createClient } from "npm:@supabase/supabase-js@2";
import { extractText, getDocumentProxy } from "npm:unpdf@0.12.1";
import { parseFactSheet } from "./dpiit.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const NSDL = "https://www.fpi.nsdl.co.in/web/Reports";
const RBI_BULLETIN = "https://www.rbi.org.in/Scripts/BS_ViewBulletin.aspx";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase());
const iso = (y: number, m: number, d = 1) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

async function get(url: string) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*", "accept-language": "en-IN,en;q=0.9" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res;
}

async function logRun(source: string, started: Date, ok: boolean, found: number, added: number, error?: string) {
  await db.from("runs").insert({
    source, started_at: started.toISOString(), finished_at: new Date().toISOString(),
    ok, items_found: found, items_new: added, error: error?.slice(0, 500) ?? null,
  });
}

const cellText = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
// "(2262.17)" is a negative number in NSDL tables.
const num = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  if (!t || t === "-") return null;
  const neg = /^\(.*\)$/.test(t);
  const v = parseFloat(t.replace(/[()]/g, ""));
  return isNaN(v) ? null : neg ? -v : v;
};
const isNum = (s: string) => /^\(?-?[\d,]+(\.\d+)?\)?$/.test(s.trim());

// ---------- NSDL: daily rows (Latest.aspx, Monthly.aspx) ----------

type Flow = { day: string; segment: string; route: string; gross_buy: number | null; gross_sell: number | null; net_cr: number | null; net_usd_m: number | null; fx: number | null };

function parseDaily(html: string): Flow[] {
  // Only the investment table; the derivative-trades table follows it.
  const start = html.search(/Trends in FPI(?:\/FII)? Investments/i);
  const end = html.indexOf("Derivative", start + 1);
  const body = html.slice(start, end > 0 ? end : undefined);
  const out: Flow[] = [];
  let day = "", segment = "", fx: number | null = null;
  for (const tr of body.split(/<tr/i).slice(1)) {
    let cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    if (!cells.length) continue;
    const d = cells[0].match(/^(\d{2})-([A-Za-z]{3})-(\d{4})$/);
    if (d) { day = iso(+d[3], monthIndex(d[2]), +d[1]); cells = cells.slice(1); }
    const rate = cells.findIndex((c) => /^Rs\.\s*[\d.]+$/.test(c));
    if (rate >= 0) { fx = parseFloat(cells[rate].replace(/Rs\.\s*/, "")); cells.splice(rate, 1); }
    if (!day) continue;
    const firstNum = cells.findIndex(isNum);
    if (firstNum < 1 || cells.length - firstNum < 4) continue;
    const labels = cells.slice(0, firstNum);
    const [buy, sell, net, usd] = cells.slice(firstNum, firstNum + 4).map(num);
    if (/total/i.test(tr.slice(0, 40)) && labels[0] === "Total") { segment = "Total"; }
    else if (labels.length >= 2) segment = labels[0];
    const route = labels.length >= 2 ? labels[1] : labels[0];
    out.push({ day, segment: segment || route, route: segment === "Total" ? "Total" : route, gross_buy: buy, gross_sell: sell, net_cr: net, net_usd_m: usd, fx });
  }
  return out;
}

// ---------- NSDL: month-by-month totals for the current calendar year ----------

const YEAR_SEGMENTS = ["Equity", "Debt-General Limit", "Debt-VRR", "Debt-FAR", "Hybrid", "MF Equity", "MF Debt", "MF Hybrid", "MF Solution Oriented", "MF Other", "AIF", "Total"];

function parseCalendarYear(html: string) {
  const year = +(html.match(/<option[^>]*selected[^>]*value="(\d{4})"/i)?.[1] ?? html.match(/<option[^>]*value="(\d{4})"[^>]*selected/i)?.[1] ?? new Date().getFullYear());
  const rows: { month: string; segment: string; net_cr: number | null }[] = [];
  for (const tr of html.split(/<tr/i).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => cellText(m[1]));
    const m = cells.length ? monthIndex(cells[0]) : -1;
    if (m < 0 || !/^[A-Za-z]+$/.test(cells[0]) || cells.length < YEAR_SEGMENTS.length + 1) continue;
    YEAR_SEGMENTS.forEach((segment, i) => rows.push({ month: iso(year, m), segment, net_cr: num(cells[i + 1]) }));
  }
  return rows;
}

async function runNsdl() {
  const started = new Date();
  try {
    const [latest, month, year] = await Promise.all([
      get(`${NSDL}/Latest.aspx`).then((r) => r.text()),
      get(`${NSDL}/Monthly.aspx`).then((r) => r.text()),
      get(`${NSDL}/Yearwise.aspx?RptType=6`).then((r) => r.text()),
    ]);
    const byKey = new Map<string, Flow>();
    [...parseDaily(month), ...parseDaily(latest)].forEach((f) => byKey.set(`${f.day}|${f.segment}|${f.route}`, f));
    const flows = [...byKey.values()].map((f) => ({ ...f, fetched_at: new Date().toISOString() }));
    const monthly = parseCalendarYear(year).map((r) => ({ ...r, fetched_at: new Date().toISOString() }));
    if (!flows.length) throw new Error("no daily rows parsed; the NSDL page layout may have changed");
    const e1 = (await db.from("fpi_flows").upsert(flows, { onConflict: "day,segment,route" })).error;
    const e2 = monthly.length ? (await db.from("fpi_monthly").upsert(monthly, { onConflict: "month,segment" })).error : null;
    if (e1 || e2) throw new Error((e1 ?? e2)!.message);
    const days = new Set(flows.map((f) => f.day)).size;
    await logRun("nsdl_flows", started, true, flows.length + monthly.length, days);
    return { daily_rows: flows.length, days, monthly_rows: monthly.length };
  } catch (e) {
    await logRun("nsdl_flows", started, false, 0, 0, (e as Error).message);
    return { error: (e as Error).message };
  }
}

// ---------- RBI Bulletin: "Foreign Investment Inflows" (US$ million) ----------

type Column = { period: string; kind: "fy" | "fytd" | "month"; start_date: string; provisional: boolean };

function parseInflows(text: string) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const bulletin = text.match(/RBI Bulletin\s+([A-Za-z]+\s+\d{4})/)?.[1] ?? null;
  const h = lines.findIndex((l) => /^Item\b/.test(l));
  if (h < 0) throw new Error("table header not found");
  const years = [...lines[h].matchAll(/(\d{4}(?:-\d{2})?)(\s*\(P\))?/g)].map((m) => ({ y: m[1], p: Boolean(m[2]) }));
  const ranges = [...lines[h + 1].matchAll(/([A-Z][a-z]{2})\.?(?:-([A-Z][a-z]{2})\.?)?/g)].map((m) => ({ from: m[1], to: m[2] ?? null }));
  if (years.length !== 5 || ranges.length !== 5) throw new Error(`unexpected header: ${lines[h]} / ${lines[h + 1]}`);
  // Column 1 is the last full financial year; 2-3 are the same months of two financial years;
  // 4-6 are single months (the last one a year earlier, then the two latest).
  const fyStart = (fy: string) => +fy.slice(0, 4);
  const cols: Column[] = [
    { period: `FY${years[0].y}`, kind: "fy", start_date: iso(fyStart(years[0].y), 3), provisional: years[0].p },
    { period: `FYTD${years[1].y}`, kind: "fytd", start_date: iso(fyStart(years[1].y), 3), provisional: years[1].p },
    { period: `FYTD${years[2].y}`, kind: "fytd", start_date: iso(fyStart(years[2].y), 3), provisional: years[2].p },
  ];
  const m4 = monthIndex(ranges[2].from), m5 = monthIndex(ranges[3].from), m6 = monthIndex(ranges[4].from);
  const y6 = +years[4].y, y5 = m5 <= m6 ? y6 : y6 - 1, y4 = m4 === m6 ? y6 - 1 : +years[3].y;
  for (const [y, m, p] of [[y4, m4, years[3].p], [y5, m5, years[4].p], [y6, m6, years[4].p]] as [number, number, boolean][]) {
    cols.push({ period: iso(y, m).slice(0, 7), kind: "month", start_date: iso(y, m), provisional: p });
  }
  const rows: { code: string; label: string; values: (number | null)[] }[] = [];
  let cur: { code: string; text: string } | null = null;
  for (const line of lines.slice(h + 3)) {
    const c = line.match(/^(\d+(?:\.\d+)*)\.?\s+(.*)$/);
    if (c && /[A-Za-z]/.test(c[2])) cur = { code: c[1], text: c[2] };
    else if (cur) cur.text += " " + line;
    else continue;
    const tokens = cur.text.split(/\s+/);
    const tail = tokens.slice(-6);
    if (tail.length === 6 && tail.every((t) => /^-?[\d,]+(\.\d+)?$|^-$/.test(t))) {
      rows.push({ code: cur.code, label: tokens.slice(0, -6).join(" "), values: tail.map((t) => (t === "-" ? null : parseFloat(t.replace(/,/g, "")))) });
      cur = null;
    }
  }
  if (!rows.length) throw new Error("no rows parsed");
  return { bulletin, cols, rows };
}

async function runRbi() {
  const started = new Date();
  try {
    const page = await (await get(RBI_BULLETIN)).text();
    const pdfs = [...new Set([...page.matchAll(/https:\/\/rbidocs\.rbi\.org\.in\/rdocs\/Bulletin\/PDFs\/(\d+)T_[0-9A-F]+\.PDF/gi)].map((m) => ({ n: +m[1], url: m[0] })).map((p) => JSON.stringify(p)))].map((s) => JSON.parse(s) as { n: number; url: string });
    // The table number moves between issues; try the files nearest to where it usually sits.
    pdfs.sort((a, b) => Math.abs(a.n - 35) - Math.abs(b.n - 35));
    for (const p of pdfs.slice(0, 12)) {
      const buf = new Uint8Array(await (await get(p.url)).arrayBuffer());
      const text = (await extractText(await getDocumentProxy(buf), { mergePages: false })).text.join("\n");
      if (!/Foreign Investment Inflows/i.test(text) || !/Direct Investment to India/i.test(text)) continue;
      const { bulletin, cols, rows } = parseInflows(text);
      const records = rows.flatMap((r) => cols.map((c, i) => ({
        period: c.period, kind: c.kind, start_date: c.start_date, provisional: c.provisional,
        code: r.code, label: r.label, usd_m: r.values[i], bulletin, fetched_at: new Date().toISOString(),
      })));
      const { error } = await db.from("foreign_investment").upsert(records, { onConflict: "period,code" });
      if (error) throw new Error(error.message);
      await logRun("rbi_fdi", started, true, records.length, cols.filter((c) => c.kind === "month").length);
      return { bulletin, table: p.n, periods: cols.map((c) => c.period), rows: rows.length };
    }
    throw new Error("Foreign Investment Inflows table not found in the latest bulletin");
  } catch (e) {
    await logRun("rbi_fdi", started, false, 0, 0, (e as Error).message);
    return { error: (e as Error).message };
  }
}

async function runDpiit(u: string) {
  const started = new Date();
  try {
    if (!/^https:\/\/(www\.)?dpiit\.gov\.in\/.+\.pdf/i.test(u)) throw new Error("expected a dpiit.gov.in PDF link");
    const buf = new Uint8Array(await (await get(u)).arrayBuffer());
    const pages = (await extractText(await getDocumentProxy(buf), { mergePages: false })).text as string[];
    const { edition, fys, rows } = parseFactSheet(pages);
    const now = new Date().toISOString();
    const { error } = await db.from("dpiit_fdi").upsert(rows.map((r) => ({ ...r, edition, source_url: u, updated_at: now })), { onConflict: "kind,name,fy" });
    if (error) throw new Error(error.message);
    await logRun("dpiit_fdi", started, true, rows.length, rows.length);
    return { edition, fys, rows: rows.length };
  } catch (e) {
    await logRun("dpiit_fdi", started, false, 0, 0, (e as Error).message);
    return { error: (e as Error).message };
  }
}

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  const params = new URL(req.url).searchParams, only = params.get("only");
  if (only === "dpiit") return Response.json({ dpiit: await runDpiit(params.get("u") || "") });
  const [nsdl, rbi] = await Promise.all([only === "rbi" ? null : runNsdl(), only === "nsdl" ? null : runRbi()]);
  return Response.json({ nsdl, rbi });
});
