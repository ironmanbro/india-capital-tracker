// Regulatory updates that affect foreign investment into India, from SEBI's and RBI's official RSS feeds.
// Only items whose title or summary names a foreign-investment term are kept; everything else SEBI and RBI
// publish is never stored. Kept items go in as event_type "regulation" with classifier "rules" and wait for the
// daily review, which writes the final summary, instruments and dates before they appear on the site.
//   POST /functions/v1/regs        (hourly; reruns are harmless)
//   POST /functions/v1/regs?dry=1  (report what would be kept and dropped; writes nothing)
// Requires header x-ingest-key = app_secrets.ingest_key.

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// RBI's server rejects requests carrying a browser user-agent header, so these are fetched plainly.
const FEEDS = [
  { source: "sebi", regulator: "SEBI", url: "https://www.sebi.gov.in/sebirss.xml" },
  { source: "rbi", regulator: "RBI", url: "https://www.rbi.org.in/notifications_rss.xml" },
  { source: "rbi", regulator: "RBI", url: "https://www.rbi.org.in/pressreleases_rss.xml" },
];

// The scope: an item must name one of these to be kept.
export const REG_TERMS = /\b(fpis?|foreign portfolio|fvcis?|foreign venture|fdi|foreign direct investment|ndi rules|non-debt instruments|odi|overseas investment|overseas direct investment|press note|gift city|gift-city|ifsc|international financial services cent|investment limits?|foreign liabilities and assets|direct investment entit|a\.\s?p\.\s?\(dir series\)|foreign exchange management \((non-debt|overseas))/i;

const INSTRUMENTS: [string, RegExp][] = [
  ["FPI", /\bfpis?\b|foreign portfolio/i],
  ["FVCI", /\bfvcis?\b|foreign venture/i],
  ["FDI", /\bfdi\b|foreign direct investment|direct investment entit|foreign liabilities and assets|ndi rules|non-debt instruments|press note/i],
  ["ODI", /\bodi\b|overseas (direct )?investment/i],
  ["GIFT City", /gift[ -]city|\bifsc\b|international financial services cent/i],
];

function docType(t: string) {
  if (/consultation paper/i.test(t)) return "consultation paper";
  if (/master direction/i.test(t)) return "master direction";
  if (/press note/i.test(t)) return "press note";
  if (/\bcircular\b|a\.\s?p\.\s?\(dir series\)/i.test(t)) return "circular";
  if (/notification|regulations?,? 20\d\d|amendment/i.test(t)) return "notification";
  return "other";
}

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const text = (s: string) => decode(decode(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => (xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] ?? "";

async function logRun(source: string, started: Date, ok: boolean, found: number, added: number, error?: string) {
  await db.from("runs").insert({ source, started_at: started.toISOString(), finished_at: new Date().toISOString(),
    ok, items_found: found, items_new: added, error: error?.slice(0, 500) ?? null });
}

export function parseRegs(xml: string, feed: (typeof FEEDS)[number]) {
  return [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const title = text(tag(it, "title")), summary = text(tag(it, "description")).slice(0, 600);
    const url = decode(tag(it, "link")).trim(), pub = new Date(text(tag(it, "pubDate")));
    const blob = `${title} ${summary}`;
    if (!title || !url || !REG_TERMS.test(blob)) return null;
    return {
      dedup_key: `${feed.source}:${url}`, title_key: `${feed.source}:${url}`, source: feed.source, source_name: feed.regulator,
      url, title, summary: summary || null, published_at: isNaN(+pub) ? null : pub.toISOString(),
      event_type: "regulation", event_types: ["regulation"], classifier: "rules", priority: 3, confidence: 0.5,
      region: "india", regulator: feed.regulator, doc_type: docType(title),
      instruments: INSTRUMENTS.filter(([, re]) => re.test(blob)).map(([n]) => n),
      issued_on: isNaN(+pub) ? null : pub.toISOString().slice(0, 10), query_tag: "regulation",
    };
  }).filter((x) => x !== null);
}

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || req.headers.get("x-ingest-key") !== secret.value) return new Response("unauthorized", { status: 401 });
  const dry = new URL(req.url).searchParams.get("dry") === "1", out: Record<string, unknown> = {};
  for (const feed of FEEDS) {
    const started = new Date();
    try {
      const res = await fetch(feed.url, { signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text(), all = (xml.match(/<item[^>]*>/g) || []).length, rows = parseRegs(xml, feed);
      if (dry) {
        const titles = [...xml.matchAll(/<item[^>]*>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) => text(m[1]));
        out[feed.url] = { items: all, kept: rows.map((r) => ({ title: r.title, instruments: r.instruments, doc_type: r.doc_type, issued_on: r.issued_on })), dropped_sample: titles.filter((t) => !rows.some((r) => r.title === t)).slice(0, 6) };
        continue;
      }
      const { error, count } = await db.from("events").upsert(rows, { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
      if (error) throw new Error(error.message);
      await logRun(`${feed.source}_regs`, started, true, all, count ?? 0);
      out[feed.url] = { items: all, in_scope: rows.length, added: count ?? 0, kept: rows.map((r) => r.title) };
    } catch (e) {
      await logRun(`${feed.source}_regs`, started, false, 0, 0, (e as Error).message);
      out[feed.url] = { error: (e as Error).message };
    }
  }
  return Response.json(out);
});
