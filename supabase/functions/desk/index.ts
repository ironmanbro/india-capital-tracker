// Market calendar from NSE: trading holidays, corporate actions (next 90 days and last 15), and current and
// upcoming IPOs and other issues. Runs in Mumbai; NSE answers only Indian addresses and needs its cookie.
// POST /functions/v1/desk   (x-ingest-key = app_secrets.ingest_key)
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
// "15-Jan-2026" -> "2026-01-15"; anything else -> null
const iso = (s: unknown) => { const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s || "").trim()); return m ? `${m[3]}-${MON[m[2].toLowerCase()]}-${m[1].padStart(2, "0")}` : null; };
const dmy = (d: Date) => `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;

let cookie = "";
async function nse(path: string) {
  if (!cookie) {
    const h = await fetch("https://www.nseindia.com/", { headers: { "user-agent": UA, accept: "text/html" } });
    cookie = (h.headers.getSetCookie?.() || []).map((c: string) => c.split(";")[0]).join("; ");
  }
  const r = await fetch(`https://www.nseindia.com${path}`, { headers: { "user-agent": UA, accept: "application/json", referer: "https://www.nseindia.com/", cookie }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`NSE ${path}: HTTP ${r.status}`);
  return r.json();
}

// Constant-time key comparison: the time taken does not hint at how much of a guessed key was right.
const sameKey = (a: string | null, b: string) => { if (a === null || a.length !== b.length) return false; let d = 0; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || !sameKey(req.headers.get("x-ingest-key"), secret.value)) return new Response("unauthorized", { status: 401 });
  const started = new Date().toISOString(), out: Record<string, unknown> = {}, errors: string[] = [];
  // Trading holidays, every segment NSE lists.
  try {
    const h = await nse("/api/holiday-master?type=trading") as Record<string, { tradingDate: string; description: string }[]>;
    const rows = Object.entries(h).flatMap(([seg, list]) => (list || []).map((x) => ({ day: iso(x.tradingDate), segment: seg, description: x.description }))).filter((r) => r.day);
    if (rows.length) { const { error } = await db.from("mkt_holidays").upsert(rows, { onConflict: "day,segment" }); if (error) throw new Error(error.message); }
    out.holidays = rows.length;
  } catch (e) { errors.push(`holidays: ${(e as Error).message}`); }
  // Corporate actions: the last 15 days and the next 90.
  try {
    const from = new Date(Date.now() - 15 * 864e5), to = new Date(Date.now() + 90 * 864e5);
    const ca = await nse(`/api/corporates-corporateActions?index=equities&from_date=${dmy(from)}&to_date=${dmy(to)}`) as Record<string, string>[];
    const seen = new Set<string>();
    const rows = ca.map((x) => ({ symbol: x.symbol, ex_date: iso(x.exDate), subject: String(x.subject || "").slice(0, 300), company: x.comp, isin: x.isin, record_date: iso(x.recDate), series: x.series, fetched_at: new Date().toISOString() }))
      .filter((r) => r.symbol && r.ex_date && r.subject && !seen.has(`${r.symbol}|${r.ex_date}|${r.subject}`) && seen.add(`${r.symbol}|${r.ex_date}|${r.subject}`));
    for (let i = 0; i < rows.length; i += 500) { const { error } = await db.from("corp_actions").upsert(rows.slice(i, i + 500), { onConflict: "symbol,ex_date,subject" }); if (error) throw new Error(error.message); }
    out.corp_actions = rows.length;
  } catch (e) { errors.push(`corporate actions: ${(e as Error).message}`); }
  // Issues open now and coming up (IPOs, SME IPOs, rights and others NSE lists).
  try {
    const lists = await Promise.all(["/api/ipo-current-issue", "/api/all-upcoming-issues?category=ipo", "/api/all-upcoming-issues?category=sme"].map((p) => nse(p).catch(() => [])));
    const rows = (lists.flat() as Record<string, string>[]).map((x) => ({
      symbol: x.symbol, company: x.companyName || x.company || x.symbol, kind: x.series || x.issueType || "IPO",
      open_date: iso(x.issueStartDate), close_date: iso(x.issueEndDate), price_band: x.issuePrice || x.priceBand || null, issue_size: x.issueSize || null, status: x.status || null, fetched_at: new Date().toISOString(),
    })).filter((r) => r.symbol);
    if (rows.length) { const { error } = await db.from("issues").upsert(rows, { onConflict: "symbol,kind" }); if (error) throw new Error(error.message); }
    out.issues = rows.length;
  } catch (e) { errors.push(`issues: ${(e as Error).message}`); }
  await db.from("runs").insert({ source: "nse_calendar", started_at: started, finished_at: new Date().toISOString(), ok: !errors.length, items_found: Number(out.corp_actions || 0) + Number(out.holidays || 0), error: errors.join("; ").slice(0, 500) || null });
  return Response.json({ ...out, errors });
});
