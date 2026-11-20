// NSDL foreign-investment limit monitor: the Red Flag list (companies near their FPI/NRI limit) and the Breach list.
// Each page offers one report per date through a postback; this loads the latest date of each.
//   POST /functions/v1/nsdl-limits            store the latest lists (fpi_limits)
//   POST /functions/v1/nsdl-limits?debug=1    return the parsed table text, write nothing
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const PAGES = { red_flag: "https://www.fpi.nsdl.co.in/web/Reports/frmRedFlagList.aspx", breach: "https://www.fpi.nsdl.co.in/web/Reports/frmThresholdlist.aspx" };
const cell = (s: string) => s.replace(/<br\s*\/?>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const isoMDY = (s: string) => { const m = /([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})/.exec(s); return m ? `${m[3]}-${MON[m[1].toLowerCase()]}-${m[2].padStart(2, "0")}` : null; };

async function page(url: string, form?: URLSearchParams) {
  const r = await fetch(url, { method: form ? "POST" : "GET", body: form, headers: { "user-agent": UA, accept: "text/html", referer: url, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) }, signal: AbortSignal.timeout(45_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
}

async function latest(url: string) {
  const first = await page(url);
  const sel = /<select[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/i.exec(first);
  if (!sel) throw new Error("no date selector");
  const opts = [...sel[2].matchAll(/<option[^>]*value="([^"]*)"[^>]*>([^<]*)</gi)].map((m) => ({ v: m[1], t: m[2].trim() })).filter((o) => o.v);
  if (!opts.length) throw new Error("no dates offered");
  const form = new URLSearchParams([...first.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi)].map(([, k, v]) => [k, v]));
  form.set("__EVENTTARGET", sel[1]); form.set("__EVENTARGUMENT", ""); form.set(sel[1], opts[0].v);
  const html = await page(url, form);
  // The report is the largest table after the selector.
  const tables = [...html.matchAll(/<table[\s\S]*?<\/table>/gi)].map((m) => m[0]).sort((a, b) => b.length - a.length);
  const rows = (tables[0] || "").split(/<tr/i).slice(1).map((tr) => tr.split(/<t[dh]\b/i).slice(1).map((c) => cell(c.slice(c.indexOf(">") + 1).split(/<\/t[dh]/i)[0])));
  return { date: isoMDY(opts[0].t) || opts[0].t, label: opts[0].t, rows: rows.filter((r) => r.length >= 3) };
}

// Constant-time key comparison: the time taken does not hint at how much of a guessed key was right.
const sameKey = (a: string | null, b: string) => { if (a === null || a.length !== b.length) return false; let d = 0; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || !sameKey(req.headers.get("x-ingest-key"), secret.value)) return new Response("unauthorized", { status: 401 });
  const debug = new URL(req.url).searchParams.get("debug") === "1";
  const out: Record<string, unknown> = {};
  for (const [list, url] of Object.entries(PAGES)) {
    try {
      const r = await latest(url);
      if (debug) { out[list] = { date: r.date, label: r.label, n: r.rows.length, head: r.rows.slice(0, 6) }; continue; }
      const head = r.rows[0].map((h) => h.toLowerCase());
      const col = (re: RegExp) => head.findIndex((h) => re.test(h));
      const iName = col(/company|name/), iIsin = col(/isin/), iLimit = col(/limit/), iHold = col(/holding|present|current/);
      const body = r.rows.slice(1).filter((x) => x.length === head.length);
      const rows = body.map((x) => ({ list, as_of: r.date, company: x[iName] || x[1], isin: iIsin >= 0 ? x[iIsin] : null, limit_text: iLimit >= 0 ? x[iLimit] : null, holding_text: iHold >= 0 ? x[iHold] : null, raw: Object.fromEntries(head.map((h, i) => [h, x[i]])) }));
      await db.from("fpi_limits").delete().eq("list", list);
      if (rows.length) { const { error } = await db.from("fpi_limits").insert(rows); if (error) throw new Error(error.message); }
      out[list] = { date: r.date, rows: rows.length, columns: head };
    } catch (e) { out[list] = { error: (e as Error).message }; }
  }
  if (!debug) await db.from("runs").insert({ source: "nsdl_limits", started_at: new Date().toISOString(), finished_at: new Date().toISOString(), ok: !Object.values(out).some((v) => (v as { error?: string }).error), error: JSON.stringify(out).slice(0, 500) });
  return Response.json(out);
});
