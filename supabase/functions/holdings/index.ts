// Owner-only: save the reviewed rows of one shareholding-pattern file.
//   POST /functions/v1/holdings  { key, company, symbol, period_end, file, rows: [{ holder, category, shares, pct }] }
// The key is checked against the SHA-256 hash in app_secrets.owner_key_hash, as in the leads function.
// Re-saving the same company and quarter replaces that holder's row, including one read from the RSS feed.

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const text = (v: unknown, max = 200) => typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
const bad = (msg: string, status = 400) => new Response(msg, { status, headers: CORS });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return bad("POST only", 405);
  let b: Record<string, unknown>;
  try { b = await req.json(); } catch { return bad("body must be JSON"); }

  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "owner_key_hash").single();
  if (!secret || (await sha256(String(b.key || ""))) !== secret.value) return bad("unauthorized", 401);

  const company = text(b.company), period_end = String(b.period_end || "");
  if (!company) return bad("company is required");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period_end)) return bad("period_end must be YYYY-MM-DD");
  if (!Array.isArray(b.rows) || !b.rows.length || b.rows.length > 500) return bad("rows must hold 1 to 500 entries");

  const rows = [];
  for (const r of b.rows as Record<string, unknown>[]) {
    const holder = text(r.holder), pct = Number(r.pct), shares = r.shares == null || r.shares === "" ? null : Number(r.shares);
    if (!holder || !Number.isFinite(pct) || pct < 0 || pct > 100 || (shares != null && !Number.isFinite(shares))) return bad(`bad row: ${JSON.stringify(r).slice(0, 120)}`);
    rows.push({ company, symbol: text(b.symbol, 40), period_end, holder, category: text(r.category), shares, pct, source_file: text(b.file), source: "upload" });
  }
  const { error } = await db.from("shareholdings").upsert(rows, { onConflict: "company,period_end,holder" });
  if (error) return bad(error.message, 500);
  return Response.json({ saved: rows.length }, { headers: CORS });
});
