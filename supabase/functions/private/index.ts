// Private (unlisted) funding rounds: general startup-funding searches plus a rotating search for each of the
// most-reported investors (a few per run, so the whole list is covered about once a day). Stories are stored
// like the other news (rules-classified, then checked by the daily review). Requires header x-ingest-key.
//   POST /functions/v1/private

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const PER_RUN = 6, WINDOW = "when:2d";
const STATIC = [
  `"funding round" India startup investors "led by"`,
  `"Series A" OR "Series B" OR "Series C" India raises "led by"`,
  `India startup raises "led by" crore OR million`,
  `"pre-IPO" round India investors`,
  `"growth round" India startup foreign investor`,
  `site:entrackr.com funding`,
  `site:inc42.com funding`,
  `site:yourstory.com funding round`,
];
const FUNDING = /(\bseed\b|pre-?seed|series [a-h]\b|pre-series|bridge round|funding round|raises? .{0,25}(\$|rs\.?|₹|usd|inr)|raised .{0,25}(\$|rs\.?|₹|usd|inr)|led by|pre-ipo|growth (round|capital)|venture (debt|round)|valuation)/i;
const INDIA = /(india|indian|bengaluru|bangalore|mumbai|delhi|gurugram|gurgaon|hyderabad|chennai|pune|startup)/i;

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const stripTags = (s: string) => decode(decode(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] ?? "";
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);

function amount(text: string): { usd_m: number | null; text: string | null } {
  const usd = text.match(/(?:\$|us\$|usd)\s?([\d.,]+)\s?(bn|billion|b|mn|million|m)\b/i);
  if (usd) { const n = parseFloat(usd[1].replace(/,/g, "")); return { usd_m: usd[2].toLowerCase().startsWith("b") ? n * 1000 : n, text: usd[0] }; }
  const inr = text.match(/(?:rs\.?|₹|inr)\s?([\d.,]+)\s?(lakh crore|crore|cr)\b/i);
  if (inr) { const n = parseFloat(inr[1].replace(/,/g, "")); const cr = inr[2].toLowerCase() === "lakh crore" ? n * 100000 : n; return { usd_m: Math.round((cr * 1e7) / 85 / 1e6 * 10) / 10, text: inr[0] }; }
  return { usd_m: null, text: null };
}

type Q = { q: string; tag: "private" | "investor"; investor?: string };

// Constant-time key comparison: the time taken does not hint at how much of a guessed key was right.
const sameKey = (a: string | null, b: string) => { if (a === null || a.length !== b.length) return false; let d = 0; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || !sameKey(req.headers.get("x-ingest-key"), secret.value)) return new Response("unauthorized", { status: 401 });
  const started = new Date();
  const { data: names } = await db.rpc("private_deal_investors", { n: 120 });
  const list = ((names ?? []) as { name: string }[]).map((r) => r.name);
  const start = list.length ? (Math.floor(Date.now() / 3.6e6) * PER_RUN) % list.length : 0;
  const picked = Array.from({ length: Math.min(PER_RUN, list.length) }, (_, i) => list[(start + i) % list.length]);
  const queries: Q[] = [
    ...STATIC.map((q): Q => ({ q, tag: "private" })),
    ...picked.map((name): Q => ({ q: `"${name}" India funding round OR invests OR leads`, tag: "investor", investor: name })),
  ];
  const errors: string[] = [], rows = new Map<string, Record<string, unknown>>();
  for (const q of queries) {
    try {
      const url = `https://news.google.com/rss/search?q=${encodeURIComponent(`${q.q} ${WINDOW}`)}&hl=en-IN&gl=IN&ceid=IN:en`;
      let res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
      if (res.status === 503 || res.status === 429) { await new Promise((r) => setTimeout(r, 4000)); res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) }); }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      for (const m of (await res.text()).matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const raw = stripTags(tag(m[1], "title")), source = stripTags(tag(m[1], "source"));
        const title = source && raw.endsWith(` - ${source}`) ? raw.slice(0, -(source.length + 3)) : raw;
        const summary = stripTags(tag(m[1], "description")).replace(title, "").replace(source, "").trim();
        const text = `${title} ${summary}`;
        if (!title || !FUNDING.test(text) || !INDIA.test(text)) continue;
        // An investor search keeps only stories that actually name the investor.
        if (q.investor && !title.toLowerCase().includes(q.investor.toLowerCase().split(/\s+/)[0])) continue;
        const key = "news:" + normKey(title);
        if (rows.has(key)) continue;
        const pub = tag(m[1], "pubDate"), amt = amount(text);
        rows.set(key, {
          dedup_key: key, title_key: key, source: "news", source_name: source, url: decode(tag(m[1], "link")).trim(), title, summary: summary || null,
          published_at: pub ? new Date(pub).toISOString() : null, event_type: "entry", event_types: ["entry"],
          parties: q.investor ? [{ name: q.investor, role: "investor", type: null }] : null, investor: q.investor ?? null,
          amount_usd_m: amt.usd_m, amount_text: amt.text, priority: 3, confidence: 0.4, classifier: "rules", query_tag: q.tag,
        });
      }
    } catch (e) { errors.push(`${q.q.slice(0, 40)}: ${(e as Error).message}`); }
    await new Promise((r) => setTimeout(r, 300));
  }
  const keys = [...rows.keys()], seen = new Set<string>();
  for (let i = 0; i < keys.length; i += 150) {
    const { data } = await db.from("events").select("dedup_key").in("dedup_key", keys.slice(i, i + 150));
    data?.forEach((r) => seen.add(r.dedup_key));
  }
  const fresh = [...rows.values()].filter((r) => !seen.has(r.dedup_key as string));
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const { error, count } = await db.from("events").upsert(fresh.slice(i, i + 200), { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
    if (error) errors.push(`db: ${error.message}`); else inserted += count ?? 0;
  }
  await db.from("runs").insert({ source: "news_private", started_at: started.toISOString(), finished_at: new Date().toISOString(), ok: errors.length < queries.length / 2, items_found: rows.size, items_new: inserted, error: errors.join(" | ").slice(0, 500) || null });
  return Response.json({ queries: queries.length, found: rows.size, inserted, errors });
});
