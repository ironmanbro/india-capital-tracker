// Tests the sources in table source_registry and collects relevant items from the ones that publish a feed.
// Rules: only public pages and feeds, one polite request at a time per site, robots.txt honoured, a plain identifying
// user agent. Sites whose terms forbid automated collection, paid databases and login or captcha portals are
// recorded as such and never fetched. Requires header x-ingest-key.
//   POST /functions/v1/registry?n=10          (tests the next n untested sources, collects from any feed found)
//   POST /functions/v1/registry?collect=1     (re-reads every source with a working feed)

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const UA = "IndiaCapitalTracker/1.0 (source check; respects robots.txt)";
const host = (u: string) => new URL(u).hostname.replace(/^www\./, "");
const hostIn = (h: string, list: string[]) => list.some((x) => h === x || h.endsWith("." + x));
const LICENSED = ["crunchbase.com", "tracxn.com", "pitchbook.com", "preqin.com", "dealroom.co", "cbinsights.com", "privco.com", "ventureintelligence.com", "bloomberg.com", "reuters.com", "newscatcherapi.com", "eventregistry.org", "newsapi.org"];
const SERVICE = ["feedly.com", "rss.app", "google.com", "bing.com", "gdeltproject.org"];
const RESTRICTED: Record<string, string> = {
  "nseindia.com": "NSE's terms forbid automated collection from its website and API; only its published RSS files are used",
  "bseindia.com": "BSE's terms restrict automated collection from its website; only a published XML feed is tested",
  "mca.gov.in": "Login and captcha portal; automated access not permitted", "mcacdm.nic.in": "Login and captcha portal; automated access not permitted",
  "zaubacorp.com": "Re-publishes MCA data; terms forbid scraping (use licensed data)", "tofler.in": "Terms forbid scraping (use licensed data)", "opencorporates.com": "Terms restrict bulk collection (API licence needed)",
  "ft.com": "Paywall", "wsj.com": "Paywall", "the-ken.com": "Paywall", "forbes.com": "Terms restrict scraping",
};
const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const strip = (s: string) => decode(decode(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (x: string, n: string) => (x.match(new RegExp(`<${n}(?:\\s[^>]*)?>([\\s\\S]*?)</${n}>`, "i")) || [])[1] ?? "";
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
const INVEST = /(invest|stake|acquir|buys?\b|bought|sells?\b|sold|divest|\bexit|\bfund|fpi|fdi|foreign|raises?\b|raised|funding|round|series [a-h]|\bipo\b|block deal|bulk deal|open offer|takeover|merger|preferential|\bqip\b|anchor|gift city|\bifsc|sovereign|pension|private equity|venture|allot)/i;
const INDIA = /(india|indian|₹|\brs\.? ?\d|crore|lakh|\bnse\b|\bbse\b|sebi|rbi|mumbai|delhi|bengaluru|bangalore|gift city|\bifsc)/i;
const EXIT = /(\bexit|sells?\b|sold|offload|divest|stake sale|pares|trims|winds? down|quits)/i, FUNDL = /(launch|unveil|first close|final close|fund of|ifsca|gift city.{0,30}(fund|licen))/i;
const AMT = (t: string) => { const m = t.match(/(?:\$|us\$|usd)\s?([\d.,]+)\s?(bn|billion|mn|million|m|b)\b/i); return m ? { usd: Math.round(parseFloat(m[1].replace(/,/g, "")) * (/^b/i.test(m[2]) ? 1000 : 1) * 10) / 10, text: m[0] } : { usd: null, text: null }; };

async function get(url: string, ms = 12000) {
  return await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xml,application/rss+xml,*/*" }, redirect: "follow", signal: AbortSignal.timeout(ms) });
}
// Longest matching rule wins; Allow beats Disallow on a tie.
function allowed(robots: string, path: string) {
  let on = false, best = -1, ok = true;
  for (const raw of robots.split(/\r?\n/)) {
    const m = raw.replace(/#.*/, "").trim().match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { on = v === "*"; continue; }
    if (!on || !v) continue;
    const re = new RegExp("^" + v.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && v.length >= best) { best = v.length; ok = k === "allow"; }
  }
  return ok;
}
function items(xml: string) {
  const out: { title: string; link: string; date: string | null; summary: string }[] = [];
  for (const m of xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const b = m[2], title = strip(tag(b, "title"));
    const link = (b.match(/<link[^>]*href=["']([^"']+)["']/i) || [])[1] || strip(tag(b, "link")) || strip(tag(b, "guid"));
    const d = new Date(strip(tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date")));
    if (title && link) out.push({ title, link: decode(link), date: isNaN(+d) ? null : d.toISOString(), summary: strip(tag(b, "description") || tag(b, "summary") || tag(b, "content")).slice(0, 400) });
  }
  return out;
}

async function collect(row: { id: string; name: string; feed_url: string; category: string }, feedXml?: string) {
  const xml = feedXml ?? await (await get(row.feed_url)).text();
  const regulator = /Regulators|Government|Regulatory|GIFT|Exchange/.test(row.category);
  const keep = items(xml).filter((i) => INVEST.test(`${i.title} ${i.summary}`) && (regulator || INDIA.test(`${i.title} ${i.summary}`) || /\.in\b|india/i.test(row.feed_url)));
  const rows = keep.map((i) => {
    const key = "news:" + normKey(i.title), t = `${i.title} ${i.summary}`, a = AMT(t), type = FUNDL.test(t) && /fund/i.test(t) ? "fund_launch" : EXIT.test(i.title) ? "exit" : "entry";
    return { dedup_key: key, title_key: key, source: "news", source_name: row.name, url: i.link, title: i.title, summary: i.summary || null, published_at: i.date, event_type: type, event_types: [type], amount_usd_m: a.usd, amount_text: a.text, priority: 3, confidence: 0.3, classifier: "rules", query_tag: "registry" };
  });
  const seen = new Set<string>();
  for (let i = 0; i < rows.length; i += 150) {
    const { data } = await db.from("events").select("dedup_key").in("dedup_key", rows.slice(i, i + 150).map((r) => r.dedup_key));
    data?.forEach((r) => seen.add(r.dedup_key));
  }
  const fresh = [...new Map(rows.filter((r) => !seen.has(r.dedup_key)).map((r) => [r.dedup_key, r])).values()];
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const { error, count } = await db.from("events").upsert(fresh.slice(i, i + 200), { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
    if (!error) inserted += count ?? 0;
  }
  return { total: items(xml).length, kept: keep.length, inserted };
}

async function probe(row: Record<string, any>) {
  const h = host(row.url), res: Record<string, any> = { tested_at: new Date().toISOString() };
  const restricted = Object.entries(RESTRICTED).find(([d]) => hostIn(h, [d]));
  const isFeedFile = /\.(xml|rss)(\?|$)/i.test(row.url);
  if (hostIn(h, LICENSED)) return { ...res, verdict: "licensed", note: "Paid or licensed data service; no automated access attempted (needs a licence or API key)" };
  if (hostIn(h, SERVICE) && h !== "news.google.com") return { ...res, verdict: "service", note: "Search, alert or aggregator service; used through its own API or RSS query pattern rather than scraped" };
  if (h === "news.google.com") return { ...res, verdict: "ok_feed", note: "Google News RSS search queries are already running every hour (47 searches)" };
  if (restricted && !isFeedFile) return { ...res, verdict: "restricted", note: restricted[1] };
  const origin = new URL(row.url).origin;
  let robots = "";
  try { const r = await get(origin + "/robots.txt", 8000); if (r.ok && /user-agent/i.test(robots = await r.text())) { /* parsed below */ } else robots = ""; } catch { robots = ""; }
  const path = new URL(row.url).pathname + new URL(row.url).search;
  if (robots && !allowed(robots, path)) return { ...res, verdict: "robots_disallow", robots: "disallows this path", note: "robots.txt asks automated tools not to fetch this path" };
  res.robots = robots ? "allows" : "no robots.txt";
  let page: Response;
  try { page = await get(row.url); } catch (e) { return { ...res, verdict: "unreachable", note: `No response: ${(e as Error).message.slice(0, 80)}` }; }
  res.http_status = page.status; res.content_type = (page.headers.get("content-type") ?? "").split(";")[0];
  const body = (await page.text()).slice(0, 400_000);
  if ([401, 403, 429, 503].includes(page.status) || /captcha|access denied|just a moment|attention required|cf-chl|enable javascript and cookies|akamai|incapsula/i.test(body.slice(0, 20000)) && page.status !== 200)
    return { ...res, verdict: "blocked", note: `Refused automated access (HTTP ${page.status}); not bypassed` };
  if (page.status >= 400) return { ...res, verdict: "unavailable", note: `HTTP ${page.status}` };
  if (/xml|rss|atom/.test(res.content_type) || /^\s*<\?xml|<rss\b|<feed\b/i.test(body.slice(0, 500))) {
    const n = items(body).length;
    return n ? { ...res, verdict: "ok_feed", feed_url: row.url, feed_items: n, note: `Feed works (${n} items)`, _xml: body } : { ...res, verdict: "ok_page", note: "XML reachable but no items found" };
  }
  const cand: string[] = [...body.matchAll(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)].map((m) => (m[0].match(/href=["']([^"']+)["']/i) || [])[1]).filter(Boolean).map((x) => new URL(x, row.url).href);
  for (const p of ["/feed", "/feed/", "/rss", "/rss.xml", "/rssfeeds", "/feeds/all.rss", "/index.xml"]) cand.push(origin + p);
  for (const f of [...new Set(cand)].slice(0, 6)) {
    if (robots && !allowed(robots, new URL(f).pathname)) continue;
    try {
      const r = await get(f, 8000); if (!r.ok) continue;
      const x = (await r.text()).slice(0, 400_000), n = /<(rss|feed)\b/i.test(x.slice(0, 1500)) ? items(x).length : 0;
      if (n) return { ...res, verdict: "ok_feed", feed_url: f, feed_items: n, note: `Feed found (${n} items)`, _xml: x };
    } catch { /* try next */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  const js = body.length < 4000 || /<noscript[^>]*>[^<]*(enable|require)[^<]*javascript/i.test(body);
  return { ...res, verdict: "ok_page", note: js ? "Page reachable but content needs JavaScript and no public feed was found" : "Page reachable (HTML); no public feed found, so nothing is collected automatically" };
}

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams, n = Math.min(+(q.get("n") ?? 8), 20), deadline = Date.now() + 110_000;
  const out: Record<string, unknown>[] = [];
  if (q.get("collect")) {
    const { data } = await db.from("source_registry").select("id,name,feed_url,category").eq("verdict", "ok_feed").not("feed_url", "is", null);
    for (const r of data ?? []) { if (Date.now() > deadline) break; try { const c = await collect(r as any); await db.rpc("registry_bump", { p_id: r.id, p_n: c.inserted }); out.push({ id: r.id, ...c }); } catch (e) { out.push({ id: r.id, error: (e as Error).message.slice(0, 80) }); } await new Promise((r) => setTimeout(r, 300)); }
    return Response.json({ collected: out });
  }
  const order = "case priority when 'Highest' then 0 when 'High' then 1 when 'Medium' then 2 else 3 end";
  const { data: todo } = await db.from("source_registry").select("*").is("tested_at", null).order("id").limit(200);
  const rows = (todo ?? []).sort((a, b) => ["Highest", "High", "Medium", "Low-Medium"].indexOf(a.priority) - ["Highest", "High", "Medium", "Low-Medium"].indexOf(b.priority) || a.id.localeCompare(b.id)).slice(0, n);
  void order;
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
    while (idx < rows.length && Date.now() < deadline) {
      const row = rows[idx++];
      try {
        const { _xml, ...res } = await probe(row) as Record<string, any>;
        let inserted = 0;
        if (res.verdict === "ok_feed" && res.feed_url) { try { inserted = (await collect({ id: row.id, name: row.name, feed_url: res.feed_url, category: row.category }, _xml)).inserted; } catch { /* keep verdict */ } }
        await db.from("source_registry").update({ ...res, collected: inserted, collected_at: inserted ? new Date().toISOString() : null }).eq("id", row.id);
        out.push({ id: row.id, verdict: res.verdict, items: res.feed_items ?? null, inserted });
      } catch (e) { out.push({ id: row.id, error: (e as Error).message.slice(0, 80) }); }
      await new Promise((r) => setTimeout(r, 300));
    }
  }));
  const { count } = await db.from("source_registry").select("id", { count: "exact", head: true }).is("tested_at", null);
  return Response.json({ tested: out.length, remaining: count, results: out });
});
