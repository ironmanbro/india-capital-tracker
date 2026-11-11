// Probe: fetch a public URL from Mumbai (NSE cookie warm-up when asked) and return status and a text sample. Writes nothing.
// Used to check new data sources. POST {"urls": [...], "nse": true|false, "n": sample length} with x-ingest-key.
import { createClient } from "npm:@supabase/supabase-js@2";
const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  const { urls, nse, n } = await req.json();
  let cookie = "";
  if (nse) { const h = await fetch("https://www.nseindia.com/", { headers: { "user-agent": UA, accept: "text/html" } }); cookie = (h.headers.getSetCookie?.() || []).map((c: string) => c.split(";")[0]).join("; "); }
  const out = [];
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { "user-agent": UA, accept: "application/json,text/html,*/*", referer: nse ? "https://www.nseindia.com/" : u, ...(cookie ? { cookie } : {}) }, signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      out.push({ u, status: r.status, len: t.length, sample: t.slice(0, n || 1500) });
    } catch (e) { out.push({ u, error: (e as Error).message }); }
  }
  return Response.json(out);
});
