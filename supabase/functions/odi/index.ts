// RBI's monthly Overseas Direct Investment data: money Indian companies commit to joint ventures (JV) and
// wholly owned subsidiaries (WOS) abroad. RBI posts one Excel workbook a month; sheet 2 lists every
// commitment (Indian party, overseas entity, country, activity, equity / loan / guarantee in USD million).
//   POST /functions/v1/odi              newest 2 releases (a monthly job is enough; reruns are harmless)
//   POST /functions/v1/odi?months=24    backfill up to 24 releases
// Requires header x-ingest-key = app_secrets.ingest_key.
// Individuals also invest abroad under ODI; their names are not stored, only that the investor is an individual.

import { createClient } from "npm:@supabase/supabase-js@2";
import * as XLSX from "npm:xlsx@0.18.5";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const LIST = "https://rbi.org.in/Scripts/Data_Overseas_Investment.aspx";
const MONTHS: Record<string, number> = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
// Words that mark a company, firm or institution rather than a person.
const ENTITY = /\b(limited|ltd|llp|pvt|private|corporation|corp|company|co\.|inc|bank|industries|enterprises|technologies|solutions|services|ventures|holdings|group|trust|fund|associates|partners|international|global|exports|pharma|labs|infra|india|systems|consultants|consulting|foundation|society|university|institute|hospital|motors|steels?|chemicals|textiles|agro|energy|power|logistics|software|digital|capital|finance|investments?|traders|trading|works|mills|products|foods|brands)\b/i;

async function logRun(started: Date, ok: boolean, found: number, added: number, error?: string) {
  await db.from("runs").insert({ source: "rbi_odi", started_at: started.toISOString(), finished_at: new Date().toISOString(),
    ok, items_found: found, items_new: added, error: error?.slice(0, 500) ?? null });
}
const get = (u: string) => fetch(u, { headers: { "user-agent": UA, referer: "https://rbi.org.in/" }, signal: AbortSignal.timeout(60_000) });
const num = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").replace(/,/g, "")) || 0);
const clean = (v: unknown) => String(v ?? "").replace(/\s+/g, " ").trim() || null;

// The list page links each release as "Overseas Direct Investment for <Month> <Year>".
async function releases(limit: number) {
  const html = await (await get(LIST)).text();
  const out: { month: string; url: string; released: string | null }[] = [];
  const re = /<th[^>]*>([A-Za-z]{3} \d{1,2}, \d{4})<\/th>[\s\S]{0,300}?href=['"]?(BS_PressReleaseDisplay\.aspx\?prid=\d+)['"]?>\s*Overseas Direct Investment for (\w+) (\d{4})/g;
  for (let m; (m = re.exec(html)) && out.length < limit;) {
    const mo = MONTHS[m[3].toLowerCase()];
    if (!mo) continue;
    out.push({ month: `${m[4]}-${String(mo).padStart(2, "0")}-01`, url: `https://rbi.org.in/Scripts/${m[2]}`, released: new Date(m[1] + " UTC").toISOString().slice(0, 10) });
  }
  return out;
}

async function loadMonth(rel: { month: string; url: string; released: string | null }) {
  const page = await (await get(rel.url)).text();
  const xlsx = /https:\/\/rbidocs\.rbi\.org\.in\/[^"' >]+\.xlsx?/i.exec(page)?.[0];
  if (!xlsx) throw new Error(`no workbook on ${rel.url}`);
  const wb = XLSX.read(new Uint8Array(await (await get(xlsx)).arrayBuffer()), { type: "array" });
  // The detail sheet is the one with a "Name of the Indian Party" header row.
  let rows: unknown[][] = [], head = -1;
  for (const n of wb.SheetNames) {
    const r = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true }) as unknown[][];
    const h = r.findIndex((x) => x.some((c) => /name of the indian party/i.test(String(c ?? ""))));
    if (h >= 0) { rows = r; head = h; break; }
  }
  if (head < 0) throw new Error(`no detail sheet in ${xlsx}`);
  // Columns move between files (some months carry an empty column), so find each one by its header.
  const col = (row: unknown[], re: RegExp) => row.findIndex((c) => re.test(String(c ?? "")));
  const h1 = rows[head], h2 = rows[head + 1] || [];
  const c = { party: col(h1, /indian party/i), jv: col(h1, /jv\/wos/i), kind: col(h1, /whether/i), country: col(h1, /country/i), activity: col(h1, /activity/i),
    equity: col(h2, /^equity/i), loan: col(h2, /^loan/i), guarantee: col(h2, /^guarantee/i), total: col(h2, /^total/i) };
  if (Object.values(c).some((i) => i < 0)) throw new Error(`unexpected columns in ${xlsx}: ${JSON.stringify(c)}`);
  const deals = [];
  for (const r of rows.slice(head + 2)) {
    const sr = Number(r[0]);
    if (!Number.isInteger(sr) || sr <= 0 || !r[c.party]) continue;
    const party = clean(r[c.party])!;
    const individual = !ENTITY.test(party);
    deals.push({
      month: rel.month, sr, indian_party: individual ? null : party, is_individual: individual,
      jv_name: clean(r[c.jv]), jv_type: clean(r[c.kind])?.toUpperCase() ?? null, country: clean(r[c.country])?.toUpperCase() ?? null, activity: clean(r[c.activity]),
      equity: num(r[c.equity]), loan: num(r[c.loan]), guarantee: num(r[c.guarantee]), total: num(r[c.total]), source_url: xlsx,
    });
  }
  if (deals.length < 50) throw new Error(`only ${deals.length} rows in ${xlsx}`);
  const sum = (k: "equity" | "loan" | "guarantee" | "total") => Math.round(deals.reduce((a, d) => a + d[k], 0) * 100) / 100;
  // Replace the month whole: RBI's serial numbers can shift if it reissues a file.
  await db.from("odi_deals").delete().eq("month", rel.month);
  for (let i = 0; i < deals.length; i += 500) {
    const { error } = await db.from("odi_deals").insert(deals.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  const { error } = await db.from("odi_monthly").upsert({ month: rel.month, equity: sum("equity"), loan: sum("loan"), guarantee: sum("guarantee"),
    total: sum("total"), deals: deals.length, source_url: xlsx, released_on: rel.released });
  if (error) throw new Error(error.message);
  return deals.length;
}

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  const started = new Date();
  const limit = Math.min(Math.max(Number(new URL(req.url).searchParams.get("months")) || 2, 1), 36);
  const done: Record<string, number | string> = {};
  let rows = 0;
  try {
    for (const rel of await releases(limit)) {
      try { rows += (done[rel.month] = await loadMonth(rel)) as number; }
      catch (e) { done[rel.month] = (e as Error).message; }
    }
    const ok = Object.values(done).some((v) => typeof v === "number");
    await logRun(started, ok, Object.keys(done).length, rows, ok ? undefined : JSON.stringify(done));
    return Response.json({ months: done, rows });
  } catch (e) {
    await logRun(started, false, 0, 0, (e as Error).message);
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
});
