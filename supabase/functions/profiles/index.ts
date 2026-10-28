// Facts about the best-known foreign holders, from Wikidata and Wikipedia (both free to reuse). For each holder
// with many filed stakes, the name must match a Wikidata entry exactly (after dropping words like "Fund") and
// the entry must read as a finance body; anything less is left blank rather than guessed. Requires x-ingest-key.
//   POST /functions/v1/profiles   (handles up to 40 holders per call, most-held first)

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "IndiaCapitalTracker/1.0 (investor profiles; contact via the site)";
const WD = "https://www.wikidata.org/w/api.php";
const TOP = 150, PER_RUN = 40;
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b/g, " ").replace(/\s+/g, " ").trim();
const FINANCE = /fund|invest|asset|bank|pension|sovereign|manage|financ|insur|capital|authority|holding|group|company|corporation|firm/i;
const get = async (url: string) => { const r = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 80)}`); return r.json(); };
const claim = (e: any, p: string) => e.claims?.[p]?.[0]?.mainsnak?.datavalue?.value;

async function lookup(holder: string) {
  const s = await get(`${WD}?action=wbsearchentities&search=${encodeURIComponent(holder)}&language=en&limit=6&format=json`);
  const hit = (s.search ?? []).find((c: any) => norm(c.label ?? "") === norm(holder) && FINANCE.test(c.description ?? ""));
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

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  const count = new Map<string, { holder: string; n: number }>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("shareholdings").select("holder").range(from, from + 999);
    data?.forEach((r) => { const k = norm(r.holder), c = count.get(k) ?? { holder: r.holder, n: 0 }; c.n++; count.set(k, c); });
    if (!data || data.length < 1000) break;
  }
  const done = new Set<string>();
  const { data: have } = await db.from("investor_profiles").select("holder");
  have?.forEach((r) => done.add(norm(r.holder)));
  const todo = [...count.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, TOP).filter(([k]) => !done.has(k)).map(([, c]) => c.holder).slice(0, PER_RUN);
  const deadline = Date.now() + 100_000;
  let found = 0, errors = 0;
  for (const holder of todo) {
    if (Date.now() > deadline) break;
    try {
      const f = await lookup(holder);
      if (f) found++;
      await db.from("investor_profiles").upsert({ holder, ...(f ?? {}), checked_at: new Date().toISOString() });
    } catch { errors++; }
  }
  return Response.json({ todo: todo.length, found, errors });
});
