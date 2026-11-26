// Offline support for the installed app. Pages and data load from the network first, so they are always current;
// when there is no signal the last copy is shown. Only public GET requests are kept; nothing else is stored.
const CACHE = "ict-v2";
const SHELL = ["/app", "/manifest.webmanifest", "/favicon.svg", "/icon-192.png"];
const DATA = "https://urpphqybqmxlwhjghsmf.supabase.co/rest/v1/";
const EDGE = "/sb/rest/v1/";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});


// Public data reads: a copy under ten minutes old is used straight away (repeat visits open instantly; the data itself refreshes hourly),
// otherwise the network answers and the copy is renewed. Offline, the last copy of any age is shown.
async function dataFetch(req) {
  const c = await caches.open(CACHE), hit = await c.match(req), tk = req.url + "#t";
  if (hit) { const t = await c.match(tk); const age = t ? Date.now() - Number(await t.text()) : Infinity; if (age < 600000) return hit; }
  try {
    const res = await fetch(req);
    if (res.ok) { c.put(req, res.clone()); c.put(tk, new Response(String(Date.now()))); }
    return res;
  } catch { if (hit) return hit; throw new Error("offline"); }
}

async function networkFirst(req, key) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(key || req, res.clone());
    return res;
  } catch {
    const hit = await cache.match(key || req);
    if (hit) return hit;
    throw new Error("offline");
  }
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  // The site itself: any page address opens the cached app shell when offline.
  if (req.mode === "navigate") { e.respondWith(networkFirst(req, "/app")); return; }
  // Public data reads (stories, flows): latest from the network, last copy when offline.
  // Requests carrying a sign-in token (a signed-in user's own lists) are never stored.
  if ((req.url.startsWith(DATA) || url.pathname.startsWith(EDGE)) && !req.headers.has("authorization")) { e.respondWith(dataFetch(req)); return; }
  // Same-origin files (icons, scripts in /vendor): cached copy first, refreshed in the background.
  if (url.origin === location.origin) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const fresh = fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }).catch(() => hit);
      return hit || fresh;
    }));
  }
});
