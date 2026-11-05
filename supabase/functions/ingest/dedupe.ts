// Story de-duplication: many outlets report the same deal. Each in-scope news item is checked
// once against the last few days of stories; a repeat points at the first report via
// `duplicate_of`, and the dashboard shows one row per story with a count of reports.
//
// With an API key the model reads the headlines and decides; without one, a headline
// word-overlap check is used (it catches most repeats but is cruder).

import Anthropic from "npm:@anthropic-ai/sdk";
// deno-lint-ignore no-explicit-any
type Db = any;

const IN_SCOPE = ["entry", "exit", "fund_launch", "relocation", "outbound"];
const WINDOW_DAYS = 5;
const COLS = "id,title,summary,source_name,event_type,published_at,fetched_at,duplicate_of";

type Row = {
  id: number; title: string; summary: string | null; source_name: string | null; event_type: string;
  published_at: string | null; fetched_at: string; duplicate_of: number | null;
};

const when = (r: Row) => new Date(r.published_at ?? r.fetched_at).getTime();

// ---------- headline overlap (no API key) ----------

const STOP = new Set((
  "the a an of in to for on at by with from as is are was its it and or over after amid into up new says said say " +
  "report reports india indian indias crore cr rs lakh billion million bn mn invest invests investing investment " +
  "investments stake stakes plans plan ipo fund funds firm company companies share shares deal deals via about some " +
  "more than will may set inr usd their this that has have be been major global top big record first"
).split(" "));

function tokens(t: string) {
  return new Set(t.toLowerCase().replace(/[’']s\b/g, "").replace(/[’']/g, "").split(/[^a-z0-9.]+/)
    .map((w) => w.replace(/^\.+|\.+$/g, "")).filter((w) => w.length > 1 && !STOP.has(w)));
}

function sameStoryByWords(a: string, b: string) {
  const A = tokens(a), B = tokens(b);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  const jaccard = shared / ((A.size + B.size - shared) || 1);
  return shared >= 3 || (shared >= 2 && jaccard >= 0.3);
}

// ---------- model ----------

const SYSTEM = `You find duplicate news stories. Several outlets often report the same real-world event: the same investor(s) doing the same transaction or announcement with the same company, fund or asset.

Two items are the SAME story when they describe the same event, even if the wording, currency, figures' rounding or level of detail differs, or one is a follow-up with extra detail on that same transaction (e.g. an IPO's anchor book reported by six outlets, or a planned investment reported first in ringgit and then in rupees).

They are DIFFERENT stories when the investor is the same but the transaction is different (another company, another fund, another stake sale), or when the company is the same but the investors or the event differ.

For each NEW item, set same_as to the id of an earlier item reporting the same event: an item from KNOWN, or a NEW item listed above it. Otherwise set same_as to null. If unsure, use null.`;

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "integer" }, same_as: { type: ["integer", "null"] } },
        required: ["id", "same_as"],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

const line = (r: Row) =>
  `[${r.id}] ${new Date(when(r)).toISOString().slice(0, 10)} ${r.event_type} | ${r.title}` +
  (r.summary ? ` | ${r.summary.slice(0, 160)}` : "");

async function sameAsByModel(client: Anthropic, model: string, known: Row[], fresh: Row[]) {
  const response = await client.beta.messages.create({
    model,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: newer request fields may be missing from the SDK's types
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{
      role: "user",
      content: `KNOWN (already in the feed):\n${known.map(line).join("\n") || "(none)"}\n\nNEW:\n${fresh.map(line).join("\n")}`,
    }],
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text) as { items: { id: number; same_as: number | null }[] };
  return new Map(parsed.items.map((i) => [i.id, i.same_as]));
}

// ---------- driver ----------

export async function dedupe(db: Db, client: Anthropic | null, model: string, deadline: number) {
  const { data: pending, error } = await db.from("events").select(COLS)
    .eq("source", "news").eq("dedup_checked", false).in("event_type", IN_SCOPE)
    .order("published_at", { ascending: true, nullsFirst: false }).limit(200);
  if (error) return { error: error.message };
  if (!pending?.length) return { checked: 0, duplicates: 0 };

  const since = new Date(Math.min(...(pending as Row[]).map(when)) - WINDOW_DAYS * 864e5).toISOString();
  const { data: knownRows } = await db.from("events").select(COLS)
    .eq("source", "news").eq("dedup_checked", true).in("event_type", IN_SCOPE)
    .gte("published_at", since).order("published_at", { ascending: true }).limit(600);
  const known: Row[] = knownRows ?? [];
  const byId = new Map<number, Row>(known.map((r) => [r.id, r]));
  const rootOf = (id: number) => byId.get(id)?.duplicate_of ?? id;

  let checked = 0, duplicates = 0;
  const errors: string[] = [];

  const settle = async (p: Row, sameAs: number | null, by: string) => {
    const root = sameAs !== null && sameAs !== p.id && byId.has(sameAs) ? rootOf(sameAs) : null;
    const { error: e } = await db.from("events")
      .update({ duplicate_of: root, dedup_checked: true, dedup_by: by }).eq("id", p.id);
    if (e) { errors.push(e.message); return; }
    // Anything that pointed at this item now points at the story's first report.
    if (root !== null) await db.from("events").update({ duplicate_of: root }).eq("duplicate_of", p.id);
    p.duplicate_of = root;
    byId.set(p.id, p);
    known.push(p);
    checked++;
    if (root !== null) duplicates++;
  };

  for (let i = 0; i < pending.length; i += 30) {
    const chunk: Row[] = pending.slice(i, i + 30);
    let decided: Map<number, number | null> | null = null;
    if (client && Date.now() < deadline) {
      const lo = Math.min(...chunk.map(when)) - WINDOW_DAYS * 864e5;
      const recent = known.filter((k) => when(k) >= lo).slice(-250);
      try {
        decided = await sameAsByModel(client, model, recent, chunk);
      } catch (e) {
        errors.push(`llm: ${(e as Error).message}`);
      }
    }
    for (const p of chunk) {
      if (decided) {
        await settle(p, decided.get(p.id) ?? null, "llm");
      } else if (!client) {
        const t = when(p);
        const matches = known.filter((k) =>
          k.event_type === p.event_type && Math.abs(when(k) - t) <= WINDOW_DAYS * 864e5 && sameStoryByWords(k.title, p.title));
        // An item that bridges two groups (e.g. one report in ringgit, one in rupees) merges them.
        const roots = [...new Set(matches.map((m) => rootOf(m.id)))]
          .sort((a, b) => when(byId.get(a)!) - when(byId.get(b)!));
        for (const other of roots.slice(1)) {
          await db.from("events").update({ duplicate_of: roots[0] }).or(`id.eq.${other},duplicate_of.eq.${other}`);
          for (const k of known) if (k.id === other || k.duplicate_of === other) k.duplicate_of = roots[0];
          duplicates++;
        }
        await settle(p, roots.length ? roots[0] : null, "rules");
      }
      // With a key but a failed call, leave the item unchecked so the next run retries it.
    }
  }
  return { checked, duplicates, errors };
}
