// CCIL FPI page: debt limit utilisation (G-sec, SDL; general route and VRR), FAR securities with FPI holdings,
// and security-wise FPI holdings under the general route. Stores one snapshot per day.
//   POST /functions/v1/ccil-fpi   (x-ingest-key = app_secrets.ingest_key)
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const PAGE = "https://www.ccilindia.com/fpi-home-page";
const DATA = `${PAGE}?p_p_id=FPI_FPIPortlet_INSTANCE_rkvf&p_p_lifecycle=2&p_p_state=normal&p_p_mode=view&p_p_resource_id=FPI&p_p_cacheability=cacheLevelPage`;

// Constant-time key comparison: the time taken does not hint at how much of a guessed key was right.
const sameKey = (a: string | null, b: string) => { if (a === null || a.length !== b.length) return false; let d = 0; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || !sameKey(req.headers.get("x-ingest-key"), secret.value)) return new Response("unauthorized", { status: 401 });
  const started = new Date().toISOString();
  try {
    const home = await fetch(PAGE, { headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(40_000) });
    const cookie = (home.headers.getSetCookie?.() || []).map((c: string) => c.split(";")[0]).join("; ");
    await home.text();
    const r = await fetch(DATA, { method: "POST", body: "", signal: AbortSignal.timeout(40_000), headers: { "user-agent": UA, cookie, "x-requested-with": "XMLHttpRequest", origin: "https://www.ccilindia.com", referer: PAGE, "content-type": "application/x-www-form-urlencoded; charset=UTF-8", accept: "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const raw = await r.json() as Record<string, string>;
    const p = (k: string) => { try { return JSON.parse(raw[k] || "[]"); } catch { return []; } };
    const limits = p("result").map((x: Record<string, number | string>) => ({ instrument: x.dlmt_ismt_indc, route: x.dlmt_pool_indc, limit_cr: +x.dlmt_absx_limt, invested_cr: +x.ddlmt_long_allx_qnty, blocks_cr: +x.dlmt_aucn_notx_util_qnty, vrr_cr: +x.dlmt_totl_vrr_util, total_cr: +x.dlmt_totl_ivst_qnty, used_pct: +x.dlmt_limt_util_pect, available_cr: +x.dlmt_totl_avbl_qnty }));
    const sec = (k: string, pre: string, kind: string) => p(k).map((x: Record<string, number | string>) => ({ kind, security: x[`${pre}_ismt_idnt`], isin: x[`${pre}_ismt_scnd_desc`], fpi_cr: +x[`${pre}_totl_util_qnty`], outstanding_cr: +x[`${pre}_ismt_issu_qnty`], pct: +x[`${pre}_outx_stdg_pect`] }));
    const securities = [...sec("result1", "dfar", "FAR"), ...sec("result2", "dsfd", "G-sec"), ...sec("result3", "dsfd", "SDL"), ...sec("result4", "dsfd", "T-bill")];
    if (!limits.length) throw new Error("no limit rows");
    const day = new Date(Date.now() + 5.5 * 36e5).toISOString().slice(0, 10);
    const { error } = await db.from("ccil_fpi").upsert({ day, limits, securities, fetched_at: new Date().toISOString() }, { onConflict: "day" });
    if (error) throw new Error(error.message);
    await db.from("runs").insert({ source: "ccil_fpi", started_at: started, finished_at: new Date().toISOString(), ok: true, items_found: securities.length + limits.length });
    return Response.json({ day, limits: limits.length, securities: securities.length });
  } catch (e) {
    await db.from("runs").insert({ source: "ccil_fpi", started_at: started, finished_at: new Date().toISOString(), ok: false, error: (e as Error).message.slice(0, 500) });
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
});
