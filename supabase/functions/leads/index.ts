// Owner-only: IFSCA directory entries with their contact details, as JSON (for the site) or CSV (download).
//   POST /functions/v1/leads  { key: <owner link code>, format?: "csv", category?: "Fund Management" }
// The key travels in the request body, never in the web address, so it stays out of logs and browser history.
// It is checked against the SHA-256 hash in app_secrets.owner_key_hash.

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type", "access-control-allow-methods": "POST, OPTIONS" };

async function sha256(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
const csvCell = (v: unknown) => {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { return new Response("body must be JSON", { status: 400, headers: CORS }); }
  const q = { get: (k: string) => (typeof b[k] === "string" ? (b[k] as string) : null) };
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "owner_key_hash").single();
  if (!secret || (await sha256(q.get("key") || "")) !== secret.value) return new Response("unauthorized", { status: 401, headers: CORS });

  const rows: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    let sel = db.from("ifsca_entities")
      .select("enc_id,name,category,sub_category,reg_no,reg_date,address,website,first_seen,ifsca_contacts(contact_name,phone,email,remarks)")
      .order("reg_date", { ascending: false, nullsFirst: false }).order("name").range(from, from + 999);
    if (q.get("category")) sel = sel.eq("category", q.get("category")!);
    const { data, error } = await sel;
    if (error) return new Response(error.message, { status: 500, headers: CORS });
    for (const r of data ?? []) {
      const c = (Array.isArray(r.ifsca_contacts) ? r.ifsca_contacts[0] : r.ifsca_contacts) ?? {};
      const { ifsca_contacts: _, ...rest } = r as Record<string, unknown>;
      rows.push({ ...rest, ...c });
    }
    if (!data || data.length < 1000) break;
  }

  if (q.get("format") === "csv") {
    const cols = ["name", "category", "sub_category", "reg_no", "reg_date", "contact_name", "phone", "email", "website", "address", "remarks"];
    const head = ["Entity", "Category", "Type", "Registration no.", "Registered on", "Contact person", "Phone", "Email", "Website", "Address", "Remarks"];
    const body = [head.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
    const day = new Date().toISOString().slice(0, 10);
    return new Response("﻿" + body, { headers: { ...CORS, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="gift-ifsc-leads-${day}.csv"` } });
  }
  return Response.json(rows, { headers: CORS });
});
