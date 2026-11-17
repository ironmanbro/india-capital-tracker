// Edge cache for the site's public data reads.
// Pages and files are served straight from Cloudflare's asset store (this Worker never runs for them).
// Only /sb/* comes here: anonymous reads of the public Supabase REST API, answered from Cloudflare's cache
// and refreshed in the background, so most visitors never wait on the database in Mumbai.
// Anything with a sign-in token, any write, and any other path is NOT cached.

const ORIGIN = "https://urpphqybqmxlwhjghsmf.supabase.co";
const FRESH = 120;            // seconds an answer is served without asking the database
const STALE = 86400;          // seconds an older answer may still be served while it refreshes
// RPC functions that return the same public summary for everyone. Nothing else is cached over POST.
const PUBLIC_RPC = new Set(["home_summary", "data_coverage", "fpi_watch", "country_brief"]);

async function sha(text) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, ctx); } catch (e) { return new Response(JSON.stringify({ message: "data service unavailable" }), { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store" } }); }
  },
};

async function handle(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname.slice(3); // drop "/sb"
    if (!path.startsWith("/rest/v1/")) return new Response("not found", { status: 404 });

    const rpc = path.startsWith("/rest/v1/rpc/") ? path.slice(13) : null;
    const isRead = req.method === "GET" || req.method === "HEAD";
    const cacheable = !req.headers.has("authorization") && !req.headers.has("x-no-cache") && (isRead || (req.method === "POST" && PUBLIC_RPC.has(rpc)));

    const upstreamInit = async () => {
      const h = new Headers();
      for (const k of ["apikey", "accept", "content-type", "prefer", "range", "accept-profile", "authorization"]) { const v = req.headers.get(k); if (v) h.set(k, v); }
      return { method: req.method, headers: h, body: req.method === "POST" ? await req.clone().text() : undefined };
    };
    const forward = async () => fetch(ORIGIN + path + url.search, await upstreamInit());

    if (!cacheable) {
      const r = await forward();
      const out = new Response(r.body, r);
      out.headers.set("Cache-Control", "no-store");
      out.headers.delete("set-cookie");
      return out;
    }

    const body = req.method === "POST" ? await req.clone().text() : "";
    const key = new Request(`https://edge-cache.invalid${path}${url.search}#${rpc ? await sha(body) : ""}${req.headers.get("prefer") || ""}${req.headers.get("range") || ""}`);
    const cache = caches.default;
    const hit = await cache.match(key);
    const now = Date.now();

    const refresh = async () => {
      const r = await forward();
      if (!r.ok) return r;
      const buf = await r.arrayBuffer();
      const headers = new Headers({ "content-type": r.headers.get("content-type") || "application/json", "x-cached-at": String(Date.now()), "cache-control": `public, max-age=${STALE}` });
      for (const k of ["content-range", "content-profile"]) { const v = r.headers.get(k); if (v) headers.set(k, v); }
      const res = new Response(buf, { status: r.status, headers });
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    };

    const send = (res, state) => {
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", `public, max-age=${FRESH}`);
      out.headers.set("x-edge", state);
      out.headers.delete("x-cached-at");
      return out;
    };

    if (hit) {
      const age = (now - Number(hit.headers.get("x-cached-at") || 0)) / 1000;
      if (age > FRESH) ctx.waitUntil(refresh().catch(() => {}));
      return send(hit, age > FRESH ? "STALE" : "HIT");
    }
    const r = await refresh();
    return r.ok ? send(r, "MISS") : r;
}
