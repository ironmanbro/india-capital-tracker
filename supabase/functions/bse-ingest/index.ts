// BSE deals receiver. BSE blocks GitHub's servers, so the BSE bulk and block deals are fetched on the owner's own
// computer (pipeline/push_bse.py) and sent here. This function holds the database key; the computer holds only
// the push key, and can write nothing except BSE deal rows.
//   POST /functions/v1/bse-ingest   header x-push-key = app_secrets.bse_push_key
//   body { records: [{ key, as_of, data }], events: [ ... ] }
// records go to feed_records (dataset bse_deals); events go to events (sources bse_bulk and bse_block only).

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const MAX_BODY = 3_000_000, MAX_ROWS = 5000;
const EVENT_FIELDS = ["dedup_key", "source", "source_name", "url", "title", "published_at", "event_type", "event_types", "parties",
  "investor", "investor_type", "target", "amount_usd_m", "amount_text", "priority", "confidence", "classifier", "query_tag", "raw"];

const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json" } });
const str = (v: unknown, max: number) => typeof v === "string" && v.length > 0 && v.length <= max;
// Same length and every character compared, so the time taken does not hint at how much of a guess was right.
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

function cleanRecord(r: any) {
  const d = r?.data;
  if (!r || !str(r.key, 300) || !/^BSE_(BULK|BLOCK)\|/.test(r.key) || !d || typeof d !== "object") return null;
  if (d.exchange !== "BSE" || !["bulk", "block"].includes(d.kind) || !/^\d{2}-[A-Za-z]{3}-\d{4}$/.test(d.date ?? "")) return null;
  if (!str(d.clientName, 300) || !["BUY", "SELL"].includes(d.buySell) || !/^\d{1,15}$/.test(String(d.qty))) return null;
  const as_of = typeof r.as_of === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.as_of) ? r.as_of : null;
  return { dataset: "bse_deals", key: r.key, as_of,
    data: { date: d.date, symbol: String(d.symbol ?? "").slice(0, 40), code: String(d.code ?? "").slice(0, 20), name: String(d.name ?? "").slice(0, 200),
      clientName: d.clientName, buySell: d.buySell, qty: String(d.qty), watp: String(d.watp ?? "").slice(0, 30), exchange: "BSE", kind: d.kind, remarks: String(d.remarks ?? "").slice(0, 200) },
    loaded_at: new Date().toISOString() };
}

function cleanEvent(e: any) {
  if (!e || !str(e.dedup_key, 400) || !/^bse_(bulk|block):/.test(e.dedup_key) || !["bse_bulk", "bse_block"].includes(e.source)) return null;
  if (!str(e.url, 300) || !e.url.startsWith("https://www.bseindia.com/") || !str(e.title, 500) || !["entry", "exit"].includes(e.event_type)) return null;
  const out: Record<string, unknown> = {};
  for (const f of EVENT_FIELDS) if (e[f] !== undefined) out[f] = e[f];
  return out;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "bse_push_key").single();
  if (!secret || !same(req.headers.get("x-push-key") ?? "", secret.value)) return json({ error: "unauthorized" }, 401);
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: "body too large" }, 413);
  let body: any;
  try { body = JSON.parse(text); } catch { return json({ error: "not json" }, 400); }
  if (!Array.isArray(body.records) || body.records.length > MAX_ROWS || (body.events && (!Array.isArray(body.events) || body.events.length > MAX_ROWS))) return json({ error: "bad shape" }, 400);

  const records = body.records.map(cleanRecord).filter(Boolean), events = (body.events ?? []).map(cleanEvent).filter(Boolean);
  const out: Record<string, unknown> = { received: body.records.length, records: records.length, events: events.length };
  if (records.length) {
    const { error } = await db.from("feed_records").upsert(records, { onConflict: "dataset,key" });
    if (error) return json({ error: "could not save records" }, 500);
  }
  if (events.length) {
    const { error } = await db.from("events").upsert(events, { onConflict: "dedup_key", ignoreDuplicates: true });
    if (error) return json({ error: "could not save events" }, 500);
  }
  return json(out);
});
