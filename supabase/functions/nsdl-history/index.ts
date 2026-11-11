// NSDL history: FPI monthly net investment by segment for one past calendar year at a time. NSDL's Yearwise page
// shows one year; the year is chosen by a postback. The selector is read from the page, so a renamed field needs
// no code change.
//   POST /functions/v1/nsdl-history?year=2024             store one year (fpi_monthly)
//   POST /functions/v1/nsdl-history?from=2024&to=2002     store a run of years, newest first, one at a time
//   POST /functions/v1/nsdl-history?discover=1            list the year selectors (writes nothing)
//   POST /functions/v1/nsdl-history?year=2023&debug=1     return the year's table (writes nothing)
// Requires header x-ingest-key = app_secrets.ingest_key. NSDL refuses requests from outside India; Supabase runs in Mumbai.

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const URL_YEARWISE = "https://www.fpi.nsdl.co.in/web/Reports/Yearwise.aspx?RptType=6";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const monthIndex = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase());
const iso = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, "0")}-01`;
const cellText = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
// "(2262.17)" is a negative number in NSDL tables.
const num = (s: string) => {
  const t = s.replace(/,/g, "").trim();
  if (!t || t === "-") return null;
  const neg = /^\(.*\)$/.test(t);
  const v = parseFloat(t.replace(/[()]/g, ""));
  return isNaN(v) ? null : neg ? -v : v;
};

// NSDL's column set changes by year: 2024 onward has 12 segments; 2020–2023 have five; 2017–2019 have four; 2002–2016 have three.
// Any other layout is reported, not guessed.
const LAYOUTS: Record<number, string[]> = {
  12: ["Equity", "Debt-General Limit", "Debt-VRR", "Debt-FAR", "Hybrid", "MF Equity", "MF Debt", "MF Hybrid", "MF Solution Oriented", "MF Other", "AIF", "Total"],
  5: ["Equity", "Debt", "Debt-VRR", "Hybrid", "Total"],
  4: ["Equity", "Debt", "Hybrid", "Total"],
  3: ["Equity", "Debt", "Total"],
};

function parseYear(html: string, year: number) {
  const rows: { month: string; segment: string; net_cr: number | null }[] = [];
  let layout: string[] | null = null;
  for (const tr of html.split(/<tr/i).slice(1)) {
    // Split on cell-opening tags: some years leave </td> out, so a closing-tag match would drop the row.
    const cells = tr.split(/<td\b/i).slice(1).map((p) => cellText(p.slice(p.indexOf(">") + 1).split(/<\/td|<td|<\/tr/i)[0]));
    const m = cells.length ? monthIndex(cells[0]) : -1;
    if (m < 0 || !/^[A-Za-z]+$/.test(cells[0])) continue;
    const names = LAYOUTS[cells.length - 1];
    if (!names) throw new Error(`unknown NSDL column layout (${cells.length - 1} columns) for ${year}`);
    layout = names;
    names.forEach((segment, i) => rows.push({ month: iso(year, m), segment, net_cr: num(cells[i + 1]) }));
  }
  if (!layout) throw new Error(`no month rows for ${year}`);
  return rows;
}

async function fetchPage(init?: { method: string; body: URLSearchParams; referer: string }) {
  const res = await fetch(URL_YEARWISE, {
    method: init ? "POST" : "GET", body: init?.body, headers: { "user-agent": UA, ...(init ? { referer: init.referer } : {}), accept: "text/html,*/*" },
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from NSDL`);
  return res.text();
}

// One calendar year: open the page, choose the year by postback, store the month rows. Retries when NSDL
// answers without the table (throttling).
async function runYear(year: number): Promise<{ year: number; rows?: number; segments?: string[]; error?: string }> {
  const started = new Date();
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      let first = "";
      for (let t = 0; t < 4; t++) {
        first = await fetchPage();
        if (/<select[^>]*name="[^"]+"/i.test(first)) break;
        await new Promise((r) => setTimeout(r, 4000 * (t + 1)));
      }
      const selects = [...first.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)]
        .map(([, name, body]) => ({ name, years: [...body.matchAll(/value="(\d{4})"/g)].map((m) => m[1]) }))
        .filter((x) => x.years.length >= 2);
      const sel = selects.find((x) => x.years.includes(String(year)));
      if (!sel) throw new Error(`year not offered by NSDL`);
      const form = new URLSearchParams([...first.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)].map(([, k, v]) => [k, v]));
      form.set("__EVENTTARGET", sel.name); form.set("__EVENTARGUMENT", ""); form.set(sel.name, String(year));
      const html = await fetchPage({ method: "POST", body: form, referer: URL_YEARWISE });
      const rows = parseYear(html, year);
      if (rows.length < 12 * 3) throw new Error(`only ${rows.length} rows parsed`);
      const stamped = rows.map((r) => ({ ...r, fetched_at: new Date().toISOString() }));
      const { error } = await db.from("fpi_monthly").upsert(stamped, { onConflict: "month,segment" });
      if (error) throw new Error(error.message);
      await db.from("runs").insert({ source: "nsdl_history", started_at: started.toISOString(), finished_at: new Date().toISOString(), ok: true, items_found: rows.length, items_new: rows.length });
      return { year, rows: rows.length, segments: [...new Set(rows.map((r) => r.segment))] };
    } catch (e) {
      lastErr = (e as Error).message;
      await new Promise((r) => setTimeout(r, 6000 * (attempt + 1)));
    }
  }
  await db.from("runs").insert({ source: "nsdl_history", started_at: started.toISOString(), finished_at: new Date().toISOString(), ok: false, error: `${year}: ${lastErr}`.slice(0, 500) });
  return { year, error: lastErr };
}

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  if (q.get("discover") === "1") {
    const first = await fetchPage();
    const selects = [...first.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)].map(([, name, body]) => ({ name, years: [...body.matchAll(/value="(\d{4})"/g)].map((m) => m[1]) }));
    return Response.json({ selects });
  }
  if (q.get("debug") === "1") {
    const year = Number(q.get("year"));
    const first = await fetchPage();
    const sel = [...first.matchAll(/<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)].find(([, , body]) => body.includes(`value="${year}"`));
    const form = new URLSearchParams([...first.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)].map(([, k, v]) => [k, v]));
    form.set("__EVENTTARGET", sel?.[1] ?? "ddl"); form.set("__EVENTARGUMENT", ""); form.set(sel?.[1] ?? "ddl", String(year));
    const html = await fetchPage({ method: "POST", body: form, referer: URL_YEARWISE });
    const t = html.indexOf("Jan");
    return Response.json({ year, table: cellText(html.slice(Math.max(0, t - 1500), t + 2500)).slice(0, 3000) });
  }
  // ?year=2024 for one year, or ?from=2024&to=2002 for a run, newest first, one year at a time.
  const from = Number(q.get("from") || q.get("year")), to = Number(q.get("to") || q.get("year"));
  if (!from || !to) return Response.json({ error: "give year, or from and to" }, { status: 400 });
  const out = [];
  for (let y = Math.max(from, to); y >= Math.min(from, to); y--) out.push(await runYear(y));
  return Response.json({ results: out });
});
