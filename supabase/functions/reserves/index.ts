// RBI Weekly Statistical Supplement, table 2: India's foreign exchange reserves (US$ million and Rs crore).
// Reads the section's list of weekly tables and stores each week not yet loaded.
//   POST /functions/v1/reserves   (x-ingest-key = app_secrets.ingest_key)
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const LIST = "https://www.rbi.org.in/Scripts/WSSViewDetail.aspx?TYPE=Section&PARAM1=2";
const MON: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
const text = (h: string) => h.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<input[^>]*>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&#8377;/g, "Rs").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ");
const get = async (u: string) => { const r = await fetch(u, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(40_000) }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); };

// Ids of the weekly "Foreign Exchange Reserves" tables, with the week's date, from the list page (whose list sits in the view state).
function weeks(html: string) {
  let body = html;
  const vs = /id="__VIEWSTATE" value="([^"]+)"/.exec(html);
  if (vs) { try { body += new TextDecoder().decode(Uint8Array.from(atob(vs[1]), (c) => c.charCodeAt(0))); } catch { /* list may be in the page itself */ } }
  const out = new Map<string, string>();
  let date = "";
  for (const m of body.matchAll(/(\d{2}) ([A-Za-z]{3}) (\d{4})<\/th>|WSSView\.aspx\?Id=(\d+)>Foreign Exchange Reserves/g)) {
    if (m[1]) date = `${m[3]}-${MON[m[2].toLowerCase()]}-${m[1]}`;
    else if (m[4] && date && !out.has(m[4])) out.set(m[4], date);
  }
  return [...out].map(([id, d]) => ({ id, issue: d }));
}

function parse(html: string) {
  const t = text(html);
  const asOn = /As on ([A-Za-z]{3})\.? (\d{1,2}), (\d{4})/i.exec(t);
  const row = (label: RegExp) => { const m = new RegExp(label.source + "[^0-9-]*((?:-?\\d+\\s+){7}-?\\d+)", "i").exec(t); return m ? m[1].trim().split(/\s+/).map(Number) : null; };
  const tot = row(/Total Reserves/), fca = row(/Foreign Currency Assets #?/), gold = row(/1\.2 Gold/), sdr = row(/SDRs/), imf = row(/Reserve (?:Tranche )?Position in the IMF/);
  if (!tot) throw new Error("table not found");
  return { week: asOn ? `${asOn[3]}-${MON[asOn[1].toLowerCase()]}-${asOn[2].padStart(2, "0")}` : null, total_cr: tot[0], total_usd_m: tot[1], wk_change_usd_m: tot[3], fca_usd_m: fca?.[1] ?? null, gold_usd_m: gold?.[1] ?? null, sdr_usd_m: sdr?.[1] ?? null, imf_usd_m: imf?.[1] ?? null };
}

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  const started = new Date().toISOString(), errors: string[] = [];
  let saved = 0;
  try {
    const list = weeks(await get(LIST));
    const { data: have } = await db.from("fx_reserves").select("src_id");
    const known = new Set((have || []).map((h) => String(h.src_id)));
    for (const w of list.filter((x) => !known.has(x.id)).slice(0, 60)) {
      try {
        const r = parse(await get(`https://www.rbi.org.in/Scripts/WSSView.aspx?Id=${w.id}`));
        const { error } = await db.from("fx_reserves").upsert({ ...r, week: r.week || w.issue, issue_date: w.issue, src_id: Number(w.id) }, { onConflict: "week" });
        if (error) throw new Error(error.message);
        saved++;
      } catch (e) { errors.push(`${w.id}: ${(e as Error).message}`); }
    }
    await db.from("runs").insert({ source: "rbi_reserves", started_at: started, finished_at: new Date().toISOString(), ok: !errors.length, items_found: list.length, items_new: saved, error: errors.join("; ").slice(0, 500) || null });
    return Response.json({ listed: list.length, saved, errors: errors.slice(0, 5) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
});
