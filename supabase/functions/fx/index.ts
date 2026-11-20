// FBIL reference rates (INR per USD, EUR, GBP, 100 JPY, AED and others) and USD/INR forward premia.
// FBIL's public feed runs about a week behind. POST /functions/v1/fx?from=2025-01-01&to=2025-03-31 for a backfill;
// with no dates it loads the last 45 days. Requires header x-ingest-key = app_secrets.ingest_key.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const BASE = "https://www.fbil.org.in/wasdm";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const day = (d: Date) => d.toISOString().slice(0, 10);

async function get(path: string, from: string, to: string) {
  const res = await fetch(`${BASE}/${path}/fetchfiltered?authenticated=false&fromDate=${from}&toDate=${to}`, { headers: { "user-agent": UA, accept: "application/json" }, signal: AbortSignal.timeout(40_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from FBIL ${path}`);
  return await res.json() as Record<string, unknown>[];
}

// Constant-time key comparison: the time taken does not hint at how much of a guessed key was right.
const sameKey = (a: string | null, b: string) => { if (a === null || a.length !== b.length) return false; let d = 0; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || !sameKey(req.headers.get("x-ingest-key"), secret.value)) return new Response("unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams;
  const to = q.get("to") || day(new Date()), from = q.get("from") || day(new Date(Date.now() - 45 * 864e5));
  const started = new Date().toISOString();
  try {
    const [ref, fwd] = await Promise.all([get("refrates", from, to), get("fwdpremia", from, to)]);
    const refRows = ref.map((r) => {
      const m = /INR\s*\/\s*(\d+)\s*([A-Z]{3})/.exec(String(r.subProdName || ""));
      if (!m) return null;
      return { day: String(r.processRunDate).slice(0, 10), ccy: m[2], rate: +(Number(r.rate) / Number(m[1])).toFixed(6) };
    }).filter(Boolean);
    const fwdRows = fwd.map((r) => ({ day: String(r.processRunDate).slice(0, 10), tenor: String(r.tenorName), premia_pct: Number(r.rate), premia_rs: Number(r.usdInrPremiaRs), settle: r.settlementDate ? String(r.settlementDate).slice(0, 10) : null }));
    if (refRows.length) { const { error } = await db.from("fx_ref").upsert(refRows, { onConflict: "day,ccy" }); if (error) throw new Error(error.message); }
    if (fwdRows.length) { const { error } = await db.from("fx_fwd").upsert(fwdRows, { onConflict: "day,tenor" }); if (error) throw new Error(error.message); }
    await db.from("runs").insert({ source: "fbil_fx", started_at: started, finished_at: new Date().toISOString(), ok: true, items_found: refRows.length + fwdRows.length, items_new: refRows.length + fwdRows.length });
    return Response.json({ from, to, ref: refRows.length, fwd: fwdRows.length });
  } catch (e) {
    await db.from("runs").insert({ source: "fbil_fx", started_at: started, finished_at: new Date().toISOString(), ok: false, error: (e as Error).message.slice(0, 500) });
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
});
