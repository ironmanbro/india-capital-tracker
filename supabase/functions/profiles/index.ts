// Facts about investors, from Wikidata and Wikipedia (both free to reuse) and from the investor's own website.
// Candidates are the best-known filed holders plus the investors the news names most. A name must match a
// Wikidata entry (after dropping words like "Fund" or "Holdings") and the entry must read as a finance body;
// anything less is left blank rather than guessed. The website step reads only the home page, after checking
// robots.txt, and keeps the site's own description, founding year, address and social links. Requires x-ingest-key.
//   POST /functions/v1/profiles   (handles up to 20 investors per call)

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "IndiaCapitalTracker/1.0 (investor profiles; contact via the site)";
const WD = "https://www.wikidata.org/w/api.php";
const TOP = 150, PER_RUN = 20;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b/g, " ").replace(/\s+/g, " ").trim();
const SUFFIX = new Set(["holdings", "holding", "group", "capital", "partners", "investments", "investment", "management", "international", "global", "asset", "company", "private", "equity", "advisors", "advisers", "financial", "services", "authority", "board", "corporation"]);
// "Temasek" matches "Temasek Holdings"; a label with any other extra word does not match.
const same = (label: string, name: string) => { const a = norm(label), b = norm(name); return a === b || (!!b && a.startsWith(b + " ") && a.slice(b.length + 1).split(" ").every((w) => SUFFIX.has(w))); };
const FINANCE = /fund|invest|asset|bank|pension|sovereign|manage|financ|insur|capital|authority|holding|group|company|corporation|firm/i;
const get = async (url: string) => { const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 80)}`); return r.json(); };
const claim = (e: any, p: string) => e.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;

const decodeHtml = (t: string) => t.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
const SOCIAL = /^https:\/\/(www\.)?(linkedin\.com|twitter\.com|x\.com|youtube\.com)\//i;
// robots.txt: skip the site if it disallows the whole site for everyone.
function blocked(robots: string) {
  let star = false;
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(), m = line.match(/^(user-agent|disallow)\s*:\s*(.*)$/i);
    if (!m) continue;
    if (m[1].toLowerCase() === "user-agent") star = m[2].trim() === "*";
    else if (star && m[2].trim() === "/") return true;
  }
  return false;
}
async function readSite(url: string) {
  const u = new URL(url);
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  // Only public host names: a website address that is an IP number, localhost or an internal name is refused.
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) || /^\d+(\.\d+){3}$/.test(u.hostname) || /\.(local|internal|localhost)$/i.test(u.hostname) || u.port) return null;
  try { const r = await fetch(`${u.origin}/robots.txt`, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(8000) }); if (r.ok && blocked(await r.text())) return null; } catch { /* no robots.txt */ }
  const res = await fetch(u.href, { headers: { "user-agent": UA, accept: "text/html" }, redirect: "follow", signal: AbortSignal.timeout(10000) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return null;
  const html = (await res.text()).slice(0, 300_000);
  const meta = (re: RegExp) => decodeHtml((html.match(re) ?? [])[1] ?? "");
  const description = meta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']*)["']/i) || meta(/<meta[^>]+content=["']([^"']*)["'][^>]+property=["']og:description["']/i)
    || meta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || meta(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i);
  const title = meta(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i) || meta(/<title[^>]*>([^<]*)<\/title>/i);
  let founded: string | null = null, address: string | null = null, links: string[] = [];
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const j = JSON.parse(m[1]), items = (Array.isArray(j) ? j : j["@graph"] ?? [j]) as Record<string, any>[];
      for (const o of items) {
        if (!/organi[sz]ation|corporation|financialservice|company/i.test(String(o["@type"]))) continue;
        founded ||= String(o.foundingDate ?? "").match(/\d{4}/)?.[0] ?? null;
        const a = o.address; if (!address && a) address = typeof a === "string" ? a : [a.addressLocality, a.addressRegion, a.addressCountry?.name ?? a.addressCountry].filter(Boolean).join(", ");
        links.push(...[o.sameAs].flat().filter((x) => typeof x === "string" && SOCIAL.test(x)));
      }
    } catch { /* not valid JSON */ }
  }
  return { site_title: title.slice(0, 120) || null, site_description: description.slice(0, 500) || null, site_founded: founded, site_address: address ? address.slice(0, 160) : null, site_links: [...new Set(links)].slice(0, 4) };
}

async function lookup(holder: string) {
  const s = await get(`${WD}?action=wbsearchentities&search=${encodeURIComponent(holder)}&language=en&limit=6&format=json`);
  const hit = (s.search ?? []).find((c: any) => same(c.label ?? "", holder) && FINANCE.test(c.description ?? ""));
  if (!hit) return null;
  const { entities } = await get(`${WD}?action=wbgetentities&ids=${hit.id}&props=claims|labels|descriptions|sitelinks&languages=en&format=json`);
  const e = entities[hit.id];
  const ids = ["P17", "P495", "P159", "P749", "P127"].map((p) => claim(e, p)?.id).filter(Boolean);
  const names: Record<string, string> = {};
  if (ids.length) {
    const l = await get(`${WD}?action=wbgetentities&ids=${[...new Set(ids)].join("|")}&props=labels&languages=en&format=json`);
    for (const [k, v] of Object.entries<any>(l.entities)) names[k] = v.labels?.en?.value;
  }
  const lab = (p: string) => names[claim(e, p)?.id] ?? null;
  const inc = claim(e, "P571")?.time?.match(/^\+?(\d{4})-(\d\d)-(\d\d)/);
  const title = e.sitelinks?.enwiki?.title;
  let summary: string | null = null;
  if (title) { try { summary = (await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`)).extract?.slice(0, 600) ?? null; } catch { /* leave blank */ } }
  return {
    wikidata_id: hit.id, label: e.labels?.en?.value ?? hit.label, description: e.descriptions?.en?.value ?? null,
    country: lab("P17") ?? lab("P495"), headquarters: lab("P159"), parent: lab("P749"), owner: lab("P127"),
    inception: inc ? (inc[2] === "00" || inc[3] === "00" ? `${inc[1]}-01-01` : `${inc[1]}-${inc[2]}-${inc[3]}`) : null,
    website: claim(e, "P856") ?? null, summary, wikipedia_url: title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}` : null,
  };
}

// Constant-time key comparison: the time taken does not hint at how much of a guessed key was right.
const sameKey = (a: string | null, b: string) => { if (a === null || a.length !== b.length) return false; let d = 0; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || !sameKey(req.headers.get("x-ingest-key"), secret.value)) return new Response("unauthorized", { status: 401 });
  // Candidates: the news's most-named investors first, then the holders with the most filed stakes.
  const count = new Map<string, { holder: string; n: number }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("shareholdings").select("holder").range(from, from + 999);
    data?.forEach((r) => { const k = norm(r.holder), c = count.get(k) ?? { holder: r.holder, n: 0 }; c.n++; count.set(k, c); });
    if (!data || data.length < 1000) break;
  }
  const { data: names } = await db.rpc("private_deal_investors", { n: 200 });
  const news = ((names ?? []) as { name: string }[]).map((r) => r.name);
  const topHolders = [...count.values()].sort((a, b) => b.n - a.n).slice(0, TOP).map((c) => c.holder);
  const pool: string[] = [], seenK = new Set<string>();
  [...news, ...topHolders].forEach((h) => { const k = norm(h); if (k && !seenK.has(k)) { seenK.add(k); pool.push(h); } });
  const { data: have } = await db.from("investor_profiles").select("holder,website,site_checked_at");
  const done = new Set((have ?? []).map((r) => norm(r.holder)));
  const needSite = (have ?? []).filter((r) => r.website && !r.site_checked_at).map((r) => ({ holder: r.holder as string, website: r.website as string }));
  const todo = pool.filter((h) => !done.has(norm(h))).slice(0, PER_RUN);
  const deadline = Date.now() + 100_000;
  let found = 0, sites = 0, errors = 0, lastError = "";
  const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // Existing profiles that have a website but whose website has not been read yet.
  for (const r of needSite.slice(0, PER_RUN)) {
    if (Date.now() > deadline) break;
    let f: Awaited<ReturnType<typeof readSite>> = null;
    try { f = await readSite(r.website); } catch (e) { lastError = (e as Error).message; }
    await db.from("investor_profiles").update({ ...(f ?? {}), site_checked_at: new Date().toISOString() }).eq("holder", r.holder);
    if (f) sites++;
    await pause(400);
  }
  for (const holder of todo) {
    if (Date.now() > deadline) break;
    try {
      const f = await lookup(holder);
      let s2: Awaited<ReturnType<typeof readSite>> = null;
      if (f) {
        found++;
        if (f.website) { try { s2 = await readSite(f.website); if (s2) sites++; } catch (e) { lastError = (e as Error).message; } }
      }
      await db.from("investor_profiles").upsert({ holder, ...(f ?? {}), ...(s2 ?? {}), ...(f?.website ? { site_checked_at: new Date().toISOString() } : {}), checked_at: new Date().toISOString() });
    } catch (e) { errors++; lastError = (e as Error).message; await pause(1500); }
    await pause(400);
  }
  return Response.json({ pool: pool.length, todo: todo.length, left: Math.max(0, pool.filter((h) => !done.has(norm(h))).length - todo.length), found, sites, errors, lastError });
});
