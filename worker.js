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

// POST /sb/bundle {paths: ["rest/v1/stories?select=...", ...]}: many public reads in one round trip, each answered through
// handle() exactly as if the page had asked for it (same cache, same freshness). Only plain table reads; no RPC, no sign-in token.
// Answer: {path: body text} for every path that succeeded; a path left out is simply fetched by the page on its own.
const BUNDLE_MAX = 60;
async function bundle(req, env, ctx) {
  if (req.method !== "POST" || req.headers.has("authorization")) return new Response("not found", { status: 404 });
  let paths;
  try { paths = (await req.json()).paths; } catch { paths = null; }
  if (!Array.isArray(paths)) return new Response("bad request", { status: 400 });
  paths = [...new Set(paths.filter((p) => typeof p === "string" && p.length < 4000 && /^rest\/v1\/[a-z_0-9]+(\?|$)/.test(p)))].slice(0, BUNDLE_MAX);
  const apikey = req.headers.get("apikey") || "";
  const base = new URL(req.url).origin + "/sb/";
  const out = {};
  await Promise.all(paths.map(async (p) => {
    try {
      const r = await handle(new Request(base + p, { headers: { apikey, accept: "application/json" } }), env, ctx);
      if (r.ok) out[p] = await r.text();      // cached answers come back as 206 (the database always sends a row range)
    } catch {}
  }));
  return new Response(JSON.stringify(out), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

async function handle(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === "/sb/bundle") return bundle(req, env, ctx);
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
    const key = "v1:" + await sha(`${path}${url.search}#${rpc ? body : ""}|${req.headers.get("prefer") || ""}|${req.headers.get("range") || ""}`);
    const kv = env.CACHE;
    const hit = await kv.getWithMetadata(key, { type: "arrayBuffer", cacheTtl: 60 });
    const now = Date.now();

    const refresh = async () => {
      const r = await forward();
      if (!r.ok) return r;
      const buf = await r.arrayBuffer();
      const meta = { ct: r.headers.get("content-type") || "application/json", at: Date.now(), cr: r.headers.get("content-range") || "" };
      if (buf.byteLength < 24 * 1024 * 1024) ctx.waitUntil(kv.put(key, buf, { metadata: meta, expirationTtl: STALE }));
      const headers = new Headers({ "content-type": meta.ct });
      if (meta.cr) headers.set("content-range", meta.cr);
      return new Response(buf, { status: r.status, headers });
    };

    const send = (res, state) => {
      const out = new Response(res.body, res);
      out.headers.set("Cache-Control", `public, max-age=${FRESH}`);
      out.headers.set("x-edge", state);
      return out;
    };

    if (hit.value) {
      const m = hit.metadata || {};
      const age = (now - Number(m.at || 0)) / 1000;
      if (age > FRESH) ctx.waitUntil(refresh().catch(() => {}));
      const headers = new Headers({ "content-type": m.ct || "application/json" });
      if (m.cr) headers.set("content-range", m.cr);
      return send(new Response(hit.value, { status: m.cr ? 206 : 200, headers }), age > FRESH ? "STALE" : "HIT");
    }
    const r = await refresh();
    return r.ok ? send(r, "MISS") : r;
}
