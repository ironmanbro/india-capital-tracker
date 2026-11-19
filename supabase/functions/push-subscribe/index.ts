// Stores or removes one browser's watchlist-alert subscription (see pipeline/alerts/README.md).
//   POST /functions/v1/push-subscribe  { action: "save",   subscription: {endpoint, keys:{p256dh, auth}}, follows: [{k,key,label}] }
//   POST /functions/v1/push-subscribe  { action: "delete", endpoint }
// Deploy with JWT verification off (browsers call it with the public key only): supabase functions deploy push-subscribe --no-verify-jwt
// Everything is validated here because the table is otherwise unreachable and the sender later POSTs to these addresses:
// only the real browser push services are accepted as endpoints.
import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const CORS = { "access-control-allow-origin": "*", "access-control-allow-headers": "content-type, apikey, authorization", "access-control-allow-methods": "POST, OPTIONS" };
const PUSH_HOSTS = /^https:\/\/(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com)\//;
const B64URL = /^[A-Za-z0-9_-]+={0,2}$/;
const KINDS = new Set(["company", "investor", "country", "topic"]);
const MAX_ROWS = 20000, MAX_FOLLOWS = 60;
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return reply(405, { error: "POST only" });
  const text = await req.text();
  if (text.length > 16_000) return reply(413, { error: "too large" });
  let b: Record<string, any>;
  try { b = JSON.parse(text); } catch { return reply(400, { error: "body must be JSON" }); }

  if (b.action === "delete") {
    const ep = String(b.endpoint ?? "");
    if (!PUSH_HOSTS.test(ep) || ep.length > 1000) return reply(400, { error: "bad endpoint" });
    const { error } = await db.from("push_subscriptions").delete().eq("endpoint", ep);
    if (error) { console.error("push-subscribe delete", error.message); return reply(500, { error: "server error" }); }
    return reply(200, { ok: true });
  }
  if (b.action !== "save") return reply(400, { error: "unknown action" });

  const s = b.subscription ?? {}, ep = String(s.endpoint ?? ""), p256dh = String(s.keys?.p256dh ?? ""), auth = String(s.keys?.auth ?? "");
  if (!PUSH_HOSTS.test(ep) || ep.length > 1000) return reply(400, { error: "bad endpoint" });
  if (!B64URL.test(p256dh) || p256dh.length > 200 || !B64URL.test(auth) || auth.length > 100) return reply(400, { error: "bad keys" });
  if (!Array.isArray(b.follows) || b.follows.length > MAX_FOLLOWS) return reply(400, { error: "bad follows" });
  const follows = [];
  for (const f of b.follows) {
    if (!f || !KINDS.has(f.k) || typeof f.key !== "string" || typeof f.label !== "string" || !f.key || f.key.length > 120 || f.label.length > 120) return reply(400, { error: "bad follow" });
    follows.push({ k: f.k, key: f.key, label: f.label });
  }
  const { data: known } = await db.from("push_subscriptions").select("endpoint").eq("endpoint", ep).maybeSingle();
  if (!known) {
    const { count } = await db.from("push_subscriptions").select("endpoint", { count: "exact", head: true });
    if ((count ?? 0) >= MAX_ROWS) return reply(503, { error: "alerts are full right now" });
  }
  // Only these columns are written, so an existing row keeps its sent and baselined history.
  const { error } = await db.from("push_subscriptions").upsert({ endpoint: ep, p256dh, auth, follows, updated_at: new Date().toISOString(), failed_at: null }, { onConflict: "endpoint" });
  if (error) { console.error("push-subscribe save", error.message); return reply(500, { error: "server error" }); }
  return reply(200, { ok: true });
});
