// Historical news import. The backfill runs outside Supabase (Google News blocks its servers), then posts
// batches here. Only news rows are accepted; each batch is at most 500 rows. Requires x-ingest-key.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const rows = await req.json().catch(() => null);
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 500) return new Response("bad batch", { status: 400 });
  const clean = rows
    .filter((r) => r && r.source === "news" && typeof r.dedup_key === "string" && typeof r.title === "string" && typeof r.event_type === "string")
    .map((r) => ({ ...r, title_key: r.dedup_key }));
  if (clean.length === 0) return Response.json({ received: rows.length, inserted: 0 });
  const { error, count } = await db.from("events").upsert(clean, { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ received: rows.length, inserted: count ?? 0 });
});
