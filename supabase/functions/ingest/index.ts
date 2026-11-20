// Ingest: pulls news + NSE bulk/block deals, classifies, stores in `events`; reads new shareholding-pattern
// filings from NSE's RSS feed into `shareholdings`.
// Called every 30 minutes by pg_cron. When ANTHROPIC_API_KEY is set, leftover time
// in each run upgrades older rule-classified items to LLM classification. Manual run:
//   POST /functions/v1/ingest            (last 1 day of news)
//   POST /functions/v1/ingest?window=7d  (last 7 days)
//   POST /functions/v1/ingest?dedupe=1   (only run the duplicate-story check)
//   POST /functions/v1/ingest?backfill=1 (collect the next unfinished week in backfill_weeks)
// Requires header x-ingest-key = app_secrets.ingest_key.

import { createClient } from "npm:@supabase/supabase-js@2";
import Anthropic from "npm:@anthropic-ai/sdk";
import { googleNewsUrl, indiaCapital, NEWS_QUERIES, NSE_FILES, RSS_FEEDS, SHP_FEED, type NewsQuery } from "./sources.ts";
import { parseFeed, parseShp } from "./shp.ts";
import { classifyLLM, classifyRules, INR_PER_USD, PRIORITY, type Classified, type RawItem } from "./classify.ts";
import { dedupe } from "./dedupe.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = Deno.env.get("CLASSIFIER_MODEL") ?? "claude-haiku-5-5";
// Rules label everything for free. The LLM only sees stories the rules found an event in but could not name an investor for,
// and never more than LLM_DAILY_CAP stories per UTC day.
const LLM_DAILY_CAP = Number(Deno.env.get("LLM_DAILY_CAP") ?? 300);

async function llmLeftToday() {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { count } = await db.from("events").select("id", { count: "exact", head: true }).gte("llm_at", start.toISOString());
  return Math.max(0, LLM_DAILY_CAP - (count ?? 0));
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";
const TIME_BUDGET_MS = 120_000;

type NewsRow = RawItem & { url: string; published_at: string | null; region?: string | null; via?: string };

// ---------- helpers ----------

async function pool<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const stripTags = (s: string) => decode(decode(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] ?? "";
const normKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);

async function logRun(source: string, started: Date, ok: boolean, found: number, inserted: number, error?: string) {
  await db.from("runs").insert({
    source, started_at: started.toISOString(), finished_at: new Date().toISOString(),
    ok, items_found: found, items_new: inserted, error: error?.slice(0, 500) ?? null,
  });
}

async function existingKeys(keys: string[]): Promise<Set<string>> {
  const seen = new Set<string>();
  for (let i = 0; i < keys.length; i += 150) {
    const { data } = await db.from("events").select("dedup_key").in("dedup_key", keys.slice(i, i + 150));
    data?.forEach((r) => seen.add(r.dedup_key));
  }
  return seen;
}

// ---------- news ----------

// Google News refuses bursts (HTTP 503), so searches go two at a time with a short gap, and a refused one
// waits longer before its single retry. Google also refuses some server addresses outright: after three
// refusals in a run, the remaining searches go to Bing News instead (same queries, same time window).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// qft: past 24 hours, newest first (without it Bing returns months-old articles).
const bingUrl = (q: NewsQuery) => `https://www.bing.com/news/search?q=${encodeURIComponent(q.q)}&format=rss&mkt=${q.edition === "IN" ? "en-IN" : "en-US"}&qft=${encodeURIComponent('interval="7"+sortbydate="1"')}`;
// "when:1d" / "when:12h" -> the oldest publish time to keep; history windows (after:/before:) are not sent to Bing.
const windowStart = (time: string) => { const m = /when:(\d+)([hd])/.exec(time); return m ? Date.now() - +m[1] * (m[2] === "h" ? 36e5 : 864e5) : null; };
function parseBing(xml: string, q: NewsQuery, since: number): NewsRow[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m): NewsRow | null => {
    const title = stripTags(tag(m[1], "title")), pub = new Date(stripTags(tag(m[1], "pubDate")));
    if (!title || isNaN(+pub) || +pub < since) return null;
    const link = decode(tag(m[1], "link")).trim(), real = /[?&]url=([^&]+)/.exec(link)?.[1];
    return { key: "news:" + normKey(title), title, summary: stripTags(tag(m[1], "description")).slice(0, 400),
      source_name: stripTags(tag(m[1], "News:Source")) || "Bing News", query_tag: q.tag,
      url: real ? decodeURIComponent(real) : link, published_at: pub.toISOString(), region: q.region ?? null, via: "bing" };
  // Bing matches loosely (e.g. "ADIA" also hits Portuguese "adia"), so foreign searches must pass the India filter.
  }).filter((r): r is NewsRow => r !== null && (!r.region || indiaCapital(`${r.title} ${r.summary}`)));
}
async function fetchNews(time: string, parallel = 2): Promise<{ rows: NewsRow[]; errors: string[] }> {
  const errors: string[] = [];
  // Each request has its own time limit, and searches not started within the budget are skipped,
  // so a slow Google response cannot push the whole run past the function's time limit.
  const stopAt = Date.now() + 90_000;
  const get = (q: NewsQuery) => fetch(googleNewsUrl(q, time), { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
  const since = windowStart(time);
  let refused = 0;
  const results = await pool(NEWS_QUERIES, parallel, async (q) => {
    if (Date.now() > stopAt) { errors.push(`${q.tag}/${q.edition} "${q.q}": skipped (time budget)`); return []; }
    if (refused >= 3 && since !== null) {
      try {
        const res = await fetch(bingUrl(q), { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) });
        if (!res.ok) throw new Error(`Bing HTTP ${res.status}`);
        return parseBing(await res.text(), q, since);
      } catch (e) { errors.push(`bing ${q.tag}/${q.edition} "${q.q}": ${(e as Error).message}`); return []; }
    }
    try {
      await sleep(600 + Math.random() * 600);
      let res = await get(q);
      if (res.status === 503 || res.status === 429) {
        if (++refused >= 3 && since !== null) return parseBing(await (await fetch(bingUrl(q), { headers: { "user-agent": UA }, signal: AbortSignal.timeout(15_000) })).text(), q, since);
        await sleep(8000 + Math.random() * 4000);
        res = await get(q);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m): NewsRow | null => {
        const raw = stripTags(tag(m[1], "title"));
        const source = stripTags(tag(m[1], "source"));
        const title = source && raw.endsWith(` - ${source}`) ? raw.slice(0, -(source.length + 3)) : raw;
        if (!title) return null;
        const pub = tag(m[1], "pubDate");
        const summary = stripTags(tag(m[1], "description")).replace(title, "").replace(source, "").trim();
        return {
          key: "news:" + normKey(title),
          title,
          summary,
          source_name: source,
          query_tag: q.tag,
          url: decode(tag(m[1], "link")).trim(),
          published_at: pub ? new Date(pub).toISOString() : null,
          region: q.region ?? null,
        };
      }).filter((r): r is NewsRow => r !== null);
    } catch (e) {
      errors.push(`${q.tag}/${q.edition} "${q.q}": ${(e as Error).message}`);
      return [];
    }
  });
  const feeds = await Promise.all(RSS_FEEDS.map(async (f): Promise<NewsRow[]> => {
    try {
      const res = await fetch(f.url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      return [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].map((m) => {
        const title = stripTags(tag(m[1], "title")), summary = stripTags(tag(m[1], "description")).slice(0, 400), pub = tag(m[1], "pubDate");
        return { key: "news:" + normKey(title), title, summary, source_name: f.name, query_tag: "foreign", region: f.region,
          url: decode(tag(m[1], "link")).trim(), published_at: pub && !isNaN(+new Date(pub)) ? new Date(pub).toISOString() : null };
      }).filter((r) => r.title && indiaCapital(`${r.title} ${r.summary}`));
    } catch (e) { errors.push(`feed ${f.name}: ${(e as Error).message}`); return []; }
  }));
  const byKey = new Map<string, NewsRow>();
  [...results.flat(), ...feeds.flat()].forEach((r) => { if (!byKey.has(r.key)) byKey.set(r.key, r); });
  return { rows: [...byKey.values()], errors };
}

function toEvent(r: NewsRow, c: Classified, classifier: string) {
  return {
    dedup_key: r.key,
    title_key: r.key,
    source: "news",
    source_name: r.source_name,
    url: r.url,
    title: r.title,
    summary: c.summary ?? (r.summary || null),
    published_at: r.published_at,
    event_type: c.event_type,
    event_types: c.event_types,
    parties: c.parties,
    investor: c.investor,
    investor_type: c.investor_type,
    investor_country: c.investor_country,
    origin_jurisdiction: c.origin_jurisdiction,
    target: c.target,
    sector: c.sector,
    amount_usd_m: c.amount_usd_m,
    amount_text: c.amount_text,
    priority: c.priority,
    confidence: c.confidence,
    classifier,
    llm_at: classifier === "llm" ? new Date().toISOString() : null,
    query_tag: r.query_tag,
    region: r.region ?? null,
  };
}

async function runNews(time: string, deadline: number, runSource = "news", parallel = 2) {
  const started = new Date();
  const { rows, errors } = await fetchNews(time, parallel);
  const seen = await existingKeys(rows.map((r) => r.key));
  const fresh = rows.filter((r) => !seen.has(r.key));

  // Rules first, so every item gets stored even if the LLM step runs out of time. Foreign-source items have
  // already been narrowed to India (the targeted searches by their query, the general RSS feeds by indiaCapital),
  // and the rules miss many foreign names, so the review decides on them.
  // Bing matches loosely, so its results are stored only when the rules find an India deal in them (foreign-source
  // ones have already passed the India filter); otherwise the review queue would fill with unrelated news.
  const events = fresh.map((r) => toEvent(r, classifyRules(r), "rules"))
    .filter((e, i) => fresh[i].via !== "bing" || e.event_type !== "irrelevant" || !!fresh[i].region);

  const llmQueue = fresh.filter((r) => events.some((e) => e.dedup_key === r.key && e.event_type !== "irrelevant" && !e.investor))
    .slice(0, API_KEY ? await llmLeftToday() : 0);
  if (llmQueue.length) {
    const client = new Anthropic({ apiKey: API_KEY! });
    const batches: NewsRow[][] = [];
    for (let i = 0; i < llmQueue.length; i += 25) batches.push(llmQueue.slice(i, i + 25));
    await pool(batches, 4, async (batch) => {
      if (Date.now() > deadline) return;
      try {
        const res = await classifyLLM(client, MODEL, batch);
        res?.forEach((c, key) => {
          const idx = events.findIndex((e) => e.dedup_key === key);
          const row = llmQueue.find((r) => r.key === key)!;
          if (idx >= 0) events[idx] = toEvent(row, c, "llm");
        });
      } catch (e) {
        errors.push(`llm: ${(e as Error).message}`);
      }
    });
  }

  let inserted = 0;
  for (let i = 0; i < events.length; i += 200) {
    const { error, count } = await db.from("events")
      .upsert(events.slice(i, i + 200), { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
    if (error) errors.push(`db: ${error.message}`);
    inserted += count ?? 0;
  }
  await logRun(runSource, started, rows.length > 0 || errors.length < NEWS_QUERIES.length / 2, rows.length, inserted, errors.join(" | ") || undefined);
  return { found: rows.length, fresh: fresh.length, inserted, errors };
}

// Upgrade rule-classified news to LLM classification (runs when an API key exists).
async function reclassify(deadline: number) {
  if (!API_KEY) return { skipped: "no ANTHROPIC_API_KEY" };
  const left = await llmLeftToday();
  if (left <= 0) return { skipped: "daily LLM cap reached" };
  const { data } = await db.from("events")
    .select("dedup_key,title,summary,source_name,query_tag,url,published_at")
    .eq("source", "news").eq("classifier", "rules").is("investor", null).neq("event_type", "irrelevant")
    .order("fetched_at", { ascending: false }).limit(Math.min(150, left));
  if (!data?.length) return { updated: 0 };
  const client = new Anthropic({ apiKey: API_KEY });
  const rows: NewsRow[] = data.map((d) => ({ ...d, key: d.dedup_key, summary: d.summary ?? "" }));
  const batches: NewsRow[][] = [];
  for (let i = 0; i < rows.length; i += 25) batches.push(rows.slice(i, i + 25));
  let updated = 0;
  const errors: string[] = [];
  await pool(batches, 4, async (batch) => {
    if (Date.now() > deadline) return;
    try {
      const res = await classifyLLM(client, MODEL, batch);
      for (const [key, c] of res ?? []) {
        const row = batch.find((r) => r.key === key)!;
        const { dedup_key: _k, title_key: _t, ...fields } = toEvent(row, c, "llm");
        // A fresh classification gets a fresh duplicate check.
        const { error } = await db.from("events")
          .update({ ...fields, duplicate_of: null, dedup_checked: false, dedup_by: null }).eq("dedup_key", key);
        if (!error) updated++;
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  });
  return { updated, errors };
}

// Re-apply the current rules to stored rule-classified news (after the rules change).
async function rerunRules() {
  // PostgREST returns at most 1,000 rows per request, so read in pages.
  const data: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error } = await db.from("events")
      .select("id,dedup_key,title,summary,source_name,query_tag,event_type,event_types,priority,investor,origin_jurisdiction")
      .eq("source", "news").eq("classifier", "rules").order("id").range(from, from + 999);
    if (error) return { error: error.message };
    data.push(...(page ?? []));
    if (!page || page.length < 1000) break;
  }
  let changed = 0;
  for (const d of data ?? []) {
    const c = classifyRules({ key: d.dedup_key, title: d.title, summary: d.summary ?? "", source_name: d.source_name ?? "", query_tag: d.query_tag ?? "" });
    if (c.event_type === d.event_type && c.priority === d.priority && c.investor === d.investor &&
      c.origin_jurisdiction === d.origin_jurisdiction && JSON.stringify(c.event_types) === JSON.stringify(d.event_types)) continue;
    const { error: e } = await db.from("events").update({
      event_type: c.event_type, event_types: c.event_types, parties: c.parties, priority: c.priority, investor: c.investor,
      origin_jurisdiction: c.origin_jurisdiction, amount_usd_m: c.amount_usd_m, amount_text: c.amount_text,
      ...(c.event_type !== d.event_type ? { duplicate_of: null, dedup_checked: false, dedup_by: null } : {}),
    }).eq("id", d.id);
    if (!e) changed++;
  }
  return { checked: data?.length ?? 0, changed };
}

// ---------- NSE bulk / block deals ----------

// Markers that a client name is a foreign/offshore entity. Heuristic: tune as you see misses.
const FOREIGN = /\b(PTE|LLC|L\.?P\.?|PLC|SICAV|ICAV|S\.?A\.?|SARL|GMBH|AG|INC|N\.?V\.?|B\.?V\.?|MAURITIUS|SINGAPORE|CAYMAN|IRELAND|LUXEMBOURG|NORWAY|ABU DHABI|DUBAI|QATAR|KUWAIT|SAUDI|JAPAN|KOREA|TAIWAN|HONG KONG|CANADA|AUSTRALIA|MASTER FUND|FEEDER|OFFSHORE|EMERGING MARKETS?|GOVERNMENT OF|MONETARY AUTHORITY|INVESTMENT AUTHORITY|PENSION|SOVEREIGN|ODI|FPI|GOLDMAN SACHS|MORGAN STANLEY|CITIGROUP|BNP PARIBAS|SOCIETE GENERALE|J\.?P\.? ?MORGAN|BOFA|MERRILL|NOMURA|UBS|CLSA|VANGUARD|BLACKROCK|GIC|NORGES|TEMASEK|FIDELITY|ABERDEEN|MACQUARIE|HSBC|BARCLAYS|CITADEL|JANE STREET|SOCIETE)\b/i;
const DOMESTIC = /(MUTUAL FUND|\bMF\b|INSURANCE|\bHUF\b|PRIVATE LIMITED|PVT\.? LTD|BROKING|SHARE BROKERS)/i;

// A client is also foreign when SEBI's FPI register has exactly that name (after norm_name(), the SQL function's twin): this
// catches registered funds with plain names such as "3 SIGMA GLOBAL FUND" (Mauritius). Read once per run; if the read fails
// the name test above still applies. Same rule as pipeline/load_feeds.py.
const normName = (t: string) => (t || "").replace(/[^a-zA-Z0-9]+/g, " ").toLowerCase()
  .replace(/\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b/g, " ").replace(/\s+/g, " ").trim();
async function fpiKeys(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await db.from("fpi_registry").select("name").order("reg_no").range(from, from + 999);
    if (error) break;
    data?.forEach((r) => { const k = normName(r.name); if (k) out.add(k); });
    if (!data || data.length < 1000) break;
  }
  return out;
}
const isForeign = (client: string, reg: Set<string>) =>
  !!client && ((FOREIGN.test(client) && !DOMESTIC.test(client)) || reg.has(normName(client)));

function parseCsv(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((line) => {
    const cells: string[] = [];
    let cur = "", q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === "," && !q) { cells.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  });
}

async function runNse() {
  const out: Record<string, unknown> = {};
  const reg = await fpiKeys();
  out.fpi_register = reg.size;
  for (const f of NSE_FILES) {
    const started = new Date();
    try {
      const res = await fetch(f.url, {
        headers: { "user-agent": UA, accept: "text/csv,*/*", referer: "https://www.nseindia.com/" },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = parseCsv(await res.text());
      const head = rows[0].map((h) => h.toLowerCase());
      const col = (re: RegExp) => head.findIndex((h) => re.test(h));
      const [cDate, cSym, cName, cClient, cSide, cQty, cPrice] =
        [/date/, /symbol|security code/, /security name|company/, /client/, /buy|sell|deal type/, /quantity/, /price/].map(col);
      if (cClient < 0) throw new Error(`unexpected header: ${rows[0].join(",")}`);

      const events = rows.slice(1).filter((r) => isForeign(r[cClient], reg))
        .map((r) => {
          const buy = /^b/i.test(r[cSide]);
          const qty = parseFloat((r[cQty] || "0").replace(/,/g, ""));
          const px = parseFloat((r[cPrice] || "0").replace(/,/g, ""));
          const crore = (qty * px) / 1e7;
          const date = new Date(r[cDate]);
          const kind = f.source.endsWith("bulk") ? "bulk" : "block";
          return {
            dedup_key: `${f.source}:${r[cDate]}:${r[cSym]}:${r[cClient]}:${r[cSide]}:${qty}`,
            source: f.source,
            source_name: f.source.startsWith("bse") ? "BSE" : "NSE",
            url: "https://www.nseindia.com/report-detail/display-bulk-and-block-deals",
            title: `${r[cClient]} ${buy ? "bought" : "sold"} ${r[cName] || r[cSym]} shares worth ₹${crore.toFixed(1)} cr (${kind} deal)`,
            published_at: isNaN(+date) ? null : date.toISOString(),
            event_type: buy ? "entry" : "exit",
            event_types: [buy ? "entry" : "exit"],
            parties: [{ name: r[cClient], role: buy ? "buyer" : "seller", type: "fpi" }],
            investor: r[cClient],
            investor_type: "fpi",
            target: r[cName] || r[cSym],
            amount_usd_m: Math.round((qty * px) / INR_PER_USD / 1e6 * 10) / 10,
            amount_text: `₹${crore.toFixed(1)} cr`,
            priority: buy ? PRIORITY.entry : PRIORITY.exit,
            confidence: 0.9,
            classifier: "structured",
            query_tag: f.source,
            raw: Object.fromEntries(rows[0].map((h, i) => [h, r[i]])),
          };
        });
      const { error, count } = await db.from("events")
        .upsert(events, { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
      if (error) throw new Error(error.message);
      await logRun(f.source, started, true, rows.length - 1, count ?? 0);
      out[f.source] = { rows: rows.length - 1, foreign: events.length, inserted: count ?? 0 };
    } catch (e) {
      await logRun(f.source, started, false, 0, 0, (e as Error).message);
      out[f.source] = { error: (e as Error).message };
    }
  }
  return out;
}

// ---------- shareholding patterns ----------

const NSE_HEADERS = { "user-agent": UA, referer: "https://www.nseindia.com/" };

// New filings from NSE's shareholding-pattern feed, oldest first and a few per run. Only foreign holders
// with 1% or more are kept, since nobody reviews these rows; a reviewed upload of the same row wins.
async function runShp(deadline: number) {
  const started = new Date();
  try {
    const res = await fetch(SHP_FEED, { headers: { ...NSE_HEADERS, accept: "application/rss+xml,application/xml,*/*" } });
    if (!res.ok) throw new Error(`feed HTTP ${res.status}`);
    const items = parseFeed(await res.text()).filter((i) => i.link);
    const seen = new Set<string>();
    for (let i = 0; i < items.length; i += 100) {
      const { data } = await db.from("shp_filings").select("link").in("link", items.slice(i, i + 100).map((x) => x.link));
      data?.forEach((d) => seen.add(d.link));
    }
    const todo = items.filter((i) => !seen.has(i.link)).reverse().slice(0, 15);
    const errors: string[] = [];
    let saved = 0;
    for (const it of todo) {
      if (Date.now() > deadline) break;
      let status = "no_xbrl", n = 0;
      if (it.xbrl) {
        try {
          const r = await fetch(it.xbrl, { headers: { ...NSE_HEADERS, accept: "application/xml,*/*" } });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const f = parseShp(await r.text(), FOREIGN, DOMESTIC);
          const company = (f.company || it.title).slice(0, 200);
          const rows = f.rows.filter((x) => x.foreign).map((x) => ({
            company, symbol: f.symbol || null, period_end: f.period_end, holder: x.holder.slice(0, 200),
            category: x.category || null, shares: x.shares, pct: x.pct, source_file: it.xbrl, source: "nse_rss",
          }));
          status = f.period_end ? "ok" : "no_date";
          if (status === "ok" && rows.length) {
            const { error } = await db.from("shareholdings").upsert(rows, { onConflict: "company,period_end,holder", ignoreDuplicates: true });
            if (error) throw new Error(error.message);
            n = rows.length;
            saved += n;
          }
        } catch (e) {
          // Left unrecorded so the next run tries this filing again.
          errors.push(`${it.title}: ${(e as Error).message}`);
          continue;
        }
      }
      await db.from("shp_filings").upsert({ link: it.link, company: it.title.slice(0, 200), xbrl: it.xbrl, filed_at: it.date, status, rows: n });
    }
    await logRun("nse_shp", started, !errors.length, todo.length, saved, errors.join("; ") || undefined);
    return { feed: items.length, read: todo.length, saved, errors: errors.length };
  } catch (e) {
    await logRun("nse_shp", started, false, 0, 0, (e as Error).message);
    return { error: (e as Error).message };
  }
}

// ---------- history ----------

// Collect one past week of news (oldest unfinished first), then merge its duplicates.
async function backfillWeek() {
  const { data: week } = await db.from("backfill_weeks").select("start").eq("done", false)
    .order("start", { ascending: true }).limit(1).maybeSingle();
  if (!week) return { done: true };
  const start = new Date(week.start + "T00:00:00Z");
  const end = new Date(start.getTime() + 7 * 864e5);
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const deadline = Date.now() + TIME_BUDGET_MS;
  const news = await runNews(`after:${day(start)} before:${day(end)}`, deadline, "news_backfill", 2);
  const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;
  const stories = await dedupe(db, client, MODEL, deadline);
  // Google News sometimes refuses bursts of requests (HTTP 503). A week where most searches
  // failed stays unfinished so a later run retries it, instead of being left empty.
  const blocked = news.errors.length > NEWS_QUERIES.length / 4;
  await db.from("backfill_weeks").update({
    done: !blocked, found: news.found, inserted: news.inserted, ran_at: new Date().toISOString(),
  }).eq("start", week.start);
  return { week: week.start, found: news.found, inserted: news.inserted, errors: news.errors.length, stories };
}

// ---------- entry ----------

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) {
    return new Response("unauthorized", { status: 401 });
  }
  const url = new URL(req.url);
  if (url.searchParams.get("rerules") === "1") return Response.json(await rerunRules());
  const client = API_KEY ? new Anthropic({ apiKey: API_KEY }) : null;
  if (url.searchParams.get("dedupe") === "1") {
    return Response.json(await dedupe(db, client, MODEL, Date.now() + TIME_BUDGET_MS));
  }
  if (url.searchParams.get("backfill") === "1") return Response.json(await backfillWeek());
  const window = /^\d+[hd]$/.test(url.searchParams.get("window") ?? "") ? url.searchParams.get("window")! : "1d";
  const deadline = Date.now() + TIME_BUDGET_MS;

  const [news, nse, shp] = await Promise.all([runNews(`when:${window}`, deadline), runNse(), runShp(deadline)]);
  const stories = await dedupe(db, client, MODEL, deadline);
  // Leftover time goes to upgrading older rule-classified items.
  const upgraded = await reclassify(deadline);
  return Response.json({ window, llm: Boolean(API_KEY), model: API_KEY ? MODEL : null, news, nse, shp, stories, upgraded });
});
