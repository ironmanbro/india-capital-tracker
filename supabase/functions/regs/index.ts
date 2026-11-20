// Regulatory updates that affect foreign investment into India, from SEBI's and RBI's official RSS feeds.
// Rule-making documents and items naming a foreign-investment term are kept; enforcement orders are never stored. Kept items go in as event_type "regulation" with classifier "rules" and wait for the
// daily review, which writes the final summary, instruments and dates before they appear on the site.
//   POST /functions/v1/regs        (hourly; reruns are harmless)
//   POST /functions/v1/regs?dry=1  (report what would be kept and dropped; writes nothing)
//   POST /functions/v1/regs?archive=1            (daily: read SEBI's and RBI's listing pages as a backup for the feeds)
//   POST /functions/v1/regs?archive=1&months=12  (history: every in-scope document from the last 12 months)
// Requires header x-ingest-key = app_secrets.ingest_key.

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// RBI's server rejects requests carrying a browser user-agent header, so these are fetched plainly.
const FEEDS = [
  { source: "sebi", regulator: "SEBI", url: "https://www.sebi.gov.in/sebirss.xml" },
  { source: "rbi", regulator: "RBI", url: "https://www.rbi.org.in/notifications_rss.xml", ruleList: true },
  { source: "rbi", regulator: "RBI", url: "https://www.rbi.org.in/pressreleases_rss.xml" },
];

// Rule-making documents are all kept and the review decides scope: many that bind FPIs/FDI never name them in the title
// (custodian, DDP, KYC, beneficial-ownership, settlement, derivatives, FEMA amendments). Enforcement orders are never kept.
const RULE_DOCS = /\b(circular|master circular|master direction|regulations?,? 20\d\d|\(amendment\)|amendment regulations|notification|consultation paper|press note|a\.\s?p\.\s?\(dir series\)|fema|foreign exchange management|framework|guidelines|directions?)\b/i;
const ORDERS = /\b(order|adjudicat|settlement order|recovery|show cause|exemption order|in the matter of|interim|confirmatory|penalty|appeal|section 35a|sahakar\w*|co-operative bank|variable rate (reverse )?repo|uapa|sanctions list|lead bank)\b/i;
const MORE_TERMS = /\b(custodian|designated depository|\bddps?\b|beneficial owner|kyc|offshore derivative|p-?notes?|\bnri|\boci\b|external commercial borrow|\becb\b|fully accessible route|voluntary retention route|sectoral cap|foreign investment|non-resident|cross-border|\blrs\b|liberalised remittance)/i;
export const inScope = (t: string, blob: string) => !ORDERS.test(t) && (RULE_DOCS.test(t) || REG_TERMS.test(blob) || MORE_TERMS.test(blob));
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

// `ruleList`: the item comes from a list that holds only rule-making documents, so only orders are excluded.
function toRow(feed: { source: string; regulator: string }, title: string, url: string, summary: string, pub: Date, ruleList = false) {
  const blob = `${title} ${summary}`;
  if (!title || !url || (ruleList ? ORDERS.test(title) : !inScope(title, blob))) return null;
  return {
    dedup_key: `${feed.source}:${url}`, title_key: `${feed.source}:${url}`, source: feed.source, source_name: feed.regulator,
    url, title, summary: summary || null, published_at: isNaN(+pub) ? null : pub.toISOString(),
    event_type: "regulation", event_types: ["regulation"], classifier: "rules", priority: 3, confidence: 0.5,
    region: "india", regulator: feed.regulator, doc_type: docType(title),
    instruments: INSTRUMENTS.filter(([, re]) => re.test(blob)).map(([n]) => n),
    issued_on: isNaN(+pub) ? null : pub.toISOString().slice(0, 10), query_tag: "regulation",
  };
}

export function parseRegs(xml: string, feed: (typeof FEEDS)[number]) {
  return [...xml.matchAll(/<item[^>]*>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const title = text(tag(it, "title")), summary = text(tag(it, "description")).slice(0, 600);
    const url = decode(tag(it, "link")).trim(), pub = new Date(text(tag(it, "pubDate")));
    return toRow(feed, title, url, summary, pub, "ruleList" in feed);
  }).filter((x) => x !== null);
}

// ---------- archive pages: daily backup for the RSS feeds, and history ----------
// SEBI's RSS shows only its latest 30 items, mostly enforcement orders, so circulars can roll off between checks.
// The listing pages hold every document: SEBI 25 per page, newest first; RBI's notifications one month per request.
const SEBI = { source: "sebi", regulator: "SEBI" }, RBI = { source: "rbi", regulator: "RBI" };
const SEBI_LISTS = [
  { sid: 1, ssid: 7 },   // circulars
  { sid: 1, ssid: 6 },   // master circulars
  { sid: 1, ssid: 3 },   // regulations
  { sid: 4, ssid: 38, open: true },  // reports, including consultation papers: filtered by title
];
const SEBI_HOME = "https://www.sebi.gov.in/sebiweb/home/HomeAction.do?doListing=yes&sid=1&ssid=7&smid=0";
const SEBI_AJAX = "https://www.sebi.gov.in/sebiweb/ajax/home/getnewslistinfo.jsp";
const RBI_NOTIF = "https://www.rbi.org.in/Scripts/NotificationUser.aspx";

// SEBI's list endpoint answers only with the session cookie from its listing page.
async function sebiCookie() {
  const r = await fetch(SEBI_HOME, { signal: AbortSignal.timeout(30_000) });
  await r.text();
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
async function sebiPage(cookie: string, l: { sid: number; ssid: number; open?: boolean }, page: number) {
  const body = new URLSearchParams({ nextValue: String(page), next: "n", search: "", fromDate: "", toDate: "", fromYear: "", toYear: "",
    deptId: "-1", sid: String(l.sid), ssid: String(l.ssid), smid: "0", ssidhidden: String(l.ssid), intmid: "-1", sText: "x", ssText: "x", smText: "", doDirect: String(page) });
  const r = await fetch(SEBI_AJAX, { method: "POST", body, signal: AbortSignal.timeout(30_000),
    headers: { cookie, referer: "https://www.sebi.gov.in/", "content-type": "application/x-www-form-urlencoded" } });
  if (!r.ok) throw new Error(`SEBI list HTTP ${r.status}`);
  const html = await r.text();
  return [...html.matchAll(/<td>([A-Z][a-z]{2} \d{2}, \d{4})<\/td>\s*<td>\s*<a href=['"](https:\/\/www\.sebi\.gov\.in\/[^'"]+)['"][^>]*title="([^"]*)"/g)]
    .map(([, d, url, t]) => ({ title: text(t), url, pub: new Date(d + " UTC") }));
}
async function rbiMonth(year?: number, month?: number) {
  let html = await (await fetch(RBI_NOTIF, { signal: AbortSignal.timeout(40_000) })).text();
  if (year) {
    const form = new URLSearchParams([...html.matchAll(/name="(__\w+)" id="\w+" value="([^"]*)"/g)].map(([, k, v]) => [k, decode(v)]));
    form.set("hdnYear", String(year)); form.set("hdnMonth", String(month));
    html = await (await fetch(RBI_NOTIF, { method: "POST", body: form, signal: AbortSignal.timeout(40_000) })).text();
  }
  const out: { title: string; url: string; pub: Date }[] = [];
  for (const block of html.split('class="tableheader"').slice(1)) {
    const d = /<b>([A-Z][a-z]{2} \d{2}, \d{4})<\/b>/.exec(block)?.[1];
    if (!d) continue;
    for (const [, id, t] of block.matchAll(/href=NotificationUser\.aspx\?Id=(\d+)&Mode=0 >([^<]+)</g))
      out.push({ title: text(t), url: `https://www.rbi.org.in/scripts/NotificationUser.aspx?Id=${id}&Mode=0`, pub: new Date(d + " UTC") });
  }
  return out;
}

// months = 0: the daily backup (first page of each SEBI list, RBI's current month).
// months = N: everything issued in the last N months.
async function runArchive(months: number, dry: boolean) {
  const started = new Date(), cutoff = Date.now() - Math.max(months, 1) * 31 * 864e5, errors: string[] = [];
  const rows: NonNullable<ReturnType<typeof toRow>>[] = [];
  const keep = (feed: typeof SEBI, items: { title: string; url: string; pub: Date }[], ruleList = false) =>
    items.forEach((i) => { if (months === 0 || +i.pub >= cutoff) { const r = toRow(feed, i.title, i.url, "", i.pub, ruleList); if (r) rows.push(r); } });
  try {
    const cookie = await sebiCookie();
    for (const l of SEBI_LISTS) {
      for (let page = 0; page < (months ? 40 : 1); page++) {
        try {
          const items = await sebiPage(cookie, l, page);
          keep(SEBI, items, !("open" in l));
          if (!items.length || +items[items.length - 1].pub < cutoff) break;
        } catch (e) { errors.push(`sebi ${l.ssid}/${page}: ${(e as Error).message}`); break; }
      }
    }
  } catch (e) { errors.push(`sebi: ${(e as Error).message}`); }
  const now = new Date();
  for (let m = 0; m < Math.max(months, 1); m++) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - m, 1));
    try { keep(RBI, await rbiMonth(m ? d.getUTCFullYear() : undefined, m ? d.getUTCMonth() + 1 : undefined), true); }
    catch (e) { errors.push(`rbi ${d.toISOString().slice(0, 7)}: ${(e as Error).message}`); }
  }
  const uniq = [...new Map(rows.map((r) => [r.dedup_key, r])).values()];
  if (dry) return { kept: uniq.length, sample: uniq.slice(0, 40).map((r) => `${r.issued_on} ${r.regulator} ${r.title}`), errors };
  let added = 0;
  for (let i = 0; i < uniq.length; i += 200) {
    const { error, count } = await db.from("events").upsert(uniq.slice(i, i + 200), { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
    if (error) errors.push(error.message); else added += count ?? 0;
  }
  await logRun(months ? "regs_backfill" : "regs_archive", started, !errors.length || added > 0, uniq.length, added, errors.join(" | ") || undefined);
  return { kept: uniq.length, added, errors };
}

// Constant-time key comparison: the time taken does not hint at how much of a guessed key was right.
const sameKey = (a: string | null, b: string) => { if (a === null || a.length !== b.length) return false; let d = 0; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || !sameKey(req.headers.get("x-ingest-key"), secret.value)) return new Response("unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams, dry = q.get("dry") === "1";
  if (q.has("archive")) return Response.json(await runArchive(Math.min(Number(q.get("months")) || 0, 60), dry));
  const out: Record<string, unknown> = {};
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
