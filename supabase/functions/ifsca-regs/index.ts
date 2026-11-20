// IFSCA (GIFT City regulator) circulars, regulations, notifications, guidelines, acts and consultation papers, from the "What's new" list on ifsca.gov.in.
// Kept items go in as event_type "regulation", regulator "IFSCA", instrument "GIFT City", with the type and date taken from the list itself.
// Nothing is summarised or interpreted: the card shows the official title and links to the document's own IFSCA page.
//   POST /functions/v1/ifsca-regs               (hourly; the last 60 days; reruns are harmless)
//   POST /functions/v1/ifsca-regs?dry=1         (report what would be kept; writes nothing)
//   POST /functions/v1/ifsca-regs?since=2021-10-01   (history: everything issued on or after that date)
// Requires header x-ingest-key = app_secrets.ingest_key. Separate from the SEBI/RBI "regs" function so a change on IFSCA's site cannot affect those.

import { createClient } from "npm:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const LIST = "https://ifsca.gov.in/home/NewSection";

// Types on the list that are rule-making or consultative; press releases only when the title says a rule or framework was notified.
const TYPES = /^(circular|master circular|regulations?|notification|guidelines?|public consultation|act|rules?|framework|directions?)$/i;
const PRESS_RULE = /\b(notif(?:y|ies|ied)|regulations?|framework|guidelines?|amend\w*|circular)\b/i;

const decode = (s: string) => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#x27;/g, "'")
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
const text = (s: string) => decode(decode(s)).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const INSTRUMENTS: [string, RegExp][] = [
  ["FPI", /\bfpis?\b|foreign portfolio/i], ["FVCI", /\bfvcis?\b|foreign venture/i],
  ["FDI", /\bfdi\b|foreign direct investment|press note/i], ["ODI", /\bodi\b|overseas (direct )?investment/i],
];
function docType(type: string) {
  const t = type.toLowerCase();
  if (t === "public consultation") return "consultation paper";
  if (t === "circular" || t === "master circular") return "circular";
  if (t.startsWith("regulation") || t === "notification" || t === "rules" || t === "rule") return "notification";
  return "other";
}

export function parseList(html: string) {
  const rows: { iso: string; type: string; title: string; url: string }[] = [];
  for (const m of html.matchAll(/<tr[^>]*>\s*<td[^>]*data-label="Date"[^>]*>\s*<span[^>]*>\s*(\d{4})(\d{2})(\d{2})\s*<\/span>[\s\S]*?<\/td>\s*<td[^>]*data-label="Type"[^>]*>\s*([^<]*?)\s*<\/td>\s*<td[^>]*data-label="Title"[^>]*>\s*<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const [, y, mo, d, type, href, title] = m;
    // Some of IFSCA's own links carry a literal space inside the token; %20 opens the same page.
    const url = decode(href).trim().replace(/ /g, "%20");
    rows.push({ iso: `${y}-${mo}-${d}`, type: text(type), title: text(title), url });
  }
  return rows;
}

export function toRow(r: { iso: string; type: string; title: string; url: string }) {
  const keep = TYPES.test(r.type) || (/^press release$/i.test(r.type) && PRESS_RULE.test(r.title));
  if (!keep || !r.title || !r.url) return null;
  const instruments = ["GIFT City", ...INSTRUMENTS.filter(([, re]) => re.test(r.title)).map(([n]) => n)];
  return {
    dedup_key: `ifsca:${r.url}`, title_key: `ifsca:${r.url}`, source: "ifsca", source_name: "IFSCA", url: r.url, title: r.title, summary: null,
    published_at: `${r.iso}T00:00:00Z`, event_type: "regulation", event_types: ["regulation"], classifier: "review", priority: 3, confidence: 0.8,
    region: "india", regulator: "IFSCA", doc_type: docType(r.type), instruments, issued_on: r.iso, query_tag: "regulation",
  };
}

// Constant-time key comparison: the time taken does not hint at how much of a guessed key was right.
const sameKey = (a: string | null, b: string) => { if (a === null || a.length !== b.length) return false; let d = 0; for (let i = 0; i < b.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; };

Deno.serve(async (req) => {
  const { data: secret } = await db.from("app_secrets").select("value").eq("name", "ingest_key").single();
  if (!secret || !sameKey(req.headers.get("x-ingest-key"), secret.value)) return new Response("unauthorized", { status: 401 });
  const q = new URL(req.url).searchParams, dry = q.get("dry") === "1", started = new Date();
  const since = /^\d{4}-\d{2}-\d{2}$/.test(q.get("since") || "") ? q.get("since")! : new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10);
  try {
    const res = await fetch(LIST, { signal: AbortSignal.timeout(60_000) });
    if (!res.ok) throw new Error(`IFSCA HTTP ${res.status}`);
    const all = parseList(await res.text());
    // A page that parses to nothing means the site changed: fail loudly instead of looking like "no news".
    if (all.length < 200) throw new Error(`IFSCA list parsed ${all.length} rows; layout may have changed`);
    const rows = [...new Map(all.filter((r) => r.iso >= since).map(toRow).filter((x) => x !== null).map((x) => [x!.dedup_key, x!])).values()];
    if (dry) return Response.json({ list_rows: all.length, since, kept: rows.length, sample: rows.slice(0, 25).map((r) => `${r.issued_on} ${r.doc_type} | ${r.title}`) });
    let added = 0;
    for (let i = 0; i < rows.length; i += 200) {
      const { error, count } = await db.from("events").upsert(rows.slice(i, i + 200), { onConflict: "dedup_key", ignoreDuplicates: true, count: "exact" });
      if (error) throw new Error(error.message);
      added += count ?? 0;
    }
    await db.from("runs").insert({ source: "ifsca_regs", started_at: started.toISOString(), finished_at: new Date().toISOString(), ok: true, items_found: rows.length, items_new: added });
    return Response.json({ list_rows: all.length, since, kept: rows.length, added });
  } catch (e) {
    await db.from("runs").insert({ source: "ifsca_regs", started_at: started.toISOString(), finished_at: new Date().toISOString(), ok: false, items_found: 0, items_new: 0, error: (e as Error).message.slice(0, 500) });
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
});
