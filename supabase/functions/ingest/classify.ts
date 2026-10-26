import Anthropic from "npm:@anthropic-ai/sdk";

export type RawItem = {
  key: string;          // dedup key
  title: string;
  summary: string;
  source_name: string;
  query_tag: string;
};

export type Party = { name: string; role: string; type: string | null };

export type Classified = {
  relevant: boolean;
  event_type: string;            // the strongest category (drives the lead score)
  event_types: string[] | null;  // every category the story belongs to
  parties: Party[] | null;       // investors involved, with their role
  investor: string | null;
  investor_type: string | null;
  investor_country: string | null;
  origin_jurisdiction: string | null;
  target: string | null;
  sector: string | null;
  amount_usd_m: number | null;
  amount_text: string | null;
  priority: number;
  confidence: number;
  summary: string | null;
};

// The tracker covers exactly four kinds of event. Everything else is "irrelevant" and hidden.
//   entry      - foreign/offshore money invested (or committed) into India
//   exit       - foreign investor exiting an Indian investment (partly or fully), a foreign company
//                closing its Indian operations, or a fund investing in India being liquidated
//   fund_launch- a fund set up outside India (offshore or GIFT City) that will invest in India,
//                its registration, licence or fund close
//   relocation - a fund that invests in India moving jurisdiction (either direction)
export const PRIORITY: Record<string, number> = {
  relocation: 5,
  fund_launch: 4,
  entry: 3,
  exit: 2,
  irrelevant: 0,
};

const INR_PER_USD = 88; // approximate; only used to rank deal size

// ---------------------------------------------------------------------------
// Rules: free, always available, decent on headlines. Used when no API key.
// Deliberately strict: when unsure, an item is dropped rather than shown.
// ---------------------------------------------------------------------------

const RULES: [string, RegExp][] = [
  ["relocation", /(relocat|re-?domicil|redomicil|migrat.{0,30}fund|(shift|mov)(e|es|ed|ing|s)? .{0,50}(fund|base|operations|hq|headquarters).{0,50}(to|from) (gift|ifsc|abu dhabi|adgm|dubai|difc|singapore|mauritius|cayman|luxembourg|ireland)|(to|from) gift city.{0,40}(relocat|shift|mov)|gift city.{0,40}(relocat|shift|mov))/],
  ["fund_launch", /(launch(es|ed)? .{0,40}fund|unveil(s|ed)? .{0,40}fund|floats? .{0,30}fund|india[- ]focused fund|new .{0,20}india fund|files? for .{0,30}etf|final close|first close|second close|hard cap|closes? .{0,40}fund at|fpi licen[cs]e|fpi registration|regist(ers|ered|ration) as (an )?fpi|ifsca (nod|approval|licen|registration|certificate)|fund management entity|fme licen|sets? up .{0,30}(fund|office|entity) .{0,30}(gift|ifsc|india))/],
  ["exit", /(\bexit(s|ed|ing)?\b|quits? india|(shuts?|shutting|closes?|closing|winds?|winding) (down )?(its )?(india|indian) (operations|business|unit|arm|stores|plant)|closing all .{0,30}(stores|outlets|branches)|pulls? out of india|\bsells?\b|\bsold\b|offload|divest|\bpares\b|\btrims\b|cuts? stake|stake sale|offer for sale|\bofs\b|wind(s|ing)? down|winding up|liquidat|shut(s|ting)? down .{0,30}fund|delist.{0,30}etf)/],
  ["entry", /(invest(s|ed|ing)? (in|into|over|up to|about|around|\$|rs|₹|usd|inr)|investment (in|into|of)|(million|billion|bn|crore|cr) investment|acquir|\bbuys?\b|\bbought\b|picks? up|stake in|takes? .{0,20}stake|raises? stake|anchor|\bqip\b|\bbacks\b|leads? .{0,30}round|funding round|infus|plans? to invest|to invest|earmark|commit(s|ted)? .{0,30}india|set to (invest|deploy|enter))/],
];

// The item has to be about India at all.
const INDIA = /(india|indian|kotak|hdfc|icici|reliance|jio|tata|infosys|wipro|adani|bajaj|mahindra|maruti|zomato|eternal|paytm|nykaa|\bola\b|swiggy|airtel|vedanta|axis bank|yes bank|idbi|\bsbi\b|gift city|\bifsc|sebi|\bnse\b|\bbse\b|nifty|sensex|crore|₹|\brs\.? ?\d|mumbai|bengaluru|bangalore|delhi|gujarat)/;
// Domestic-only vehicles (Indian mutual fund NFOs etc.) are out of scope.
const DOMESTIC = /(mutual fund|\bmf\b|\bnfo\b|\bsif\b|retail investors?|\bipo\b.{0,40}(subscri|gmp|allot)|smallcase|sip\b)/;
// Signals that the money is foreign / offshore.
const FOREIGN_HINT = /(foreign|global|overseas|offshore|cross-border|exits? india|exit from india|pulls? out of india|(india|indian) (operations|business)|fairfax|\bfpis?\b|\bfiis?\b|sovereign|pension fund|us-based|uk-based|singapore|japan|japanese|uae|abu dhabi|dubai|saudi|qatar|kuwait|korea|korean|china|chinese|german|french|dutch|swiss|canad|australian|european|american|british|cdpq|cppib|ontario teachers|adia|mubadala|\bgic\b|temasek|kkr|blackstone|carlyle|warburg|bain capital|brookfield|apollo|tpg|advent|\beqt\b|softbank|general atlantic|tiger global|goldman|morgan stanley|jp ?morgan|blackrock|vanguard|nomura|norges|\bcvc\b|actis|\bifc\b|\badb\b|\bbii\b|franklin|templeton|capital group|fidelity|t\. ?rowe|wellington|abrdn|aberdeen|schroders|amundi|hsbc|\bubs\b|citadel|millennium|sequoia|peak xv|lightspeed|\baccel\b|prosus|naspers|alibaba|ant group|amazon|walmart|google|alphabet|\bmeta\b|microsoft|\bqia\b|qatar investment|\bpif\b|mitsubishi|sumitomo|mizuho|nomura|daiwa|orix|stellantis|carrefour|7-eleven|holcim|gift city|\bifsc)/;
// A fund launch counts only if the fund is set up outside India (GIFT City / IFSC counts as offshore).
const LAUNCH_SCOPE = /(offshore|overseas|gift city|\bifsc|ifsca|luxembourg|ireland|ucits|cayman|singapore|mauritius|dubai|difc|adgm|abu dhabi|us-listed|listed in the us|nyse|nasdaq|london|tokyo|japan|korea|hong kong|india[- ]focused|india etf|india fund|india opportunit|\bfpi\b|feeder)/;
// Domestic Indian vehicles (SEBI AIFs, onshore PE/VC funds, mutual funds) are out of scope for launches.
const DOMESTIC_FUND = /(\baif\b|category (i|ii|iii)|sebi-registered|mutual fund|\bmf\b|\bnfo\b|\bamc\b(?!.{0,40}gift))/;

const SUBJECT_VERBS =
  /^(.+?)\s+(invests?|to invest|acquires?|buys?|picks up|sells?|offloads?|exits?|launch(es)?|raises?|pares|trims|divests?|backs|leads|plans|eyes|closes|shifts|relocates|unveils|marks|gets|receives|bets|commits|to (acquire|buy|sell|exit|launch|set up))\b/i;

function guessInvestor(title: string): string | null {
  const m = title.match(SUBJECT_VERBS);
  if (!m) return null;
  const s = m[1].replace(/^['"‘“]|['"’”]$/g, "").replace(/^(pe|vc) (firm|fund|major)\s+/i, "").trim();
  return s.split(/\s+/).length <= 7 ? s : null;
}

export function parseAmount(text: string): { usd_m: number | null; text: string | null } {
  const usd = text.match(/(?:\$|us\$|usd)\s?([\d.,]+)\s?(bn|billion|b|mn|million|m)\b/i);
  if (usd) {
    const n = parseFloat(usd[1].replace(/,/g, ""));
    const unit = usd[2].toLowerCase();
    return { usd_m: unit.startsWith("b") ? n * 1000 : n, text: usd[0] };
  }
  const inr = text.match(/(?:rs\.?|₹|inr)\s?([\d.,]+)\s?(lakh crore|crore|cr)\b/i);
  if (inr) {
    const n = parseFloat(inr[1].replace(/,/g, ""));
    const crore = inr[2].toLowerCase() === "lakh crore" ? n * 100000 : n;
    return { usd_m: Math.round((crore * 1e7) / INR_PER_USD / 1e6 * 10) / 10, text: inr[0] };
  }
  return { usd_m: null, text: null };
}

export function classifyRules(item: RawItem): Classified {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  let type = "irrelevant";
  if (INDIA.test(text)) {
    for (const [t, re] of RULES) {
      if (re.test(text)) { type = t; break; }
    }
  }
  // Sports and entertainment headlines reuse words like "exits India" and "series".
  if (/(cricket|t20|\bodi\b|test series|squad|\bipl\b|innings|wicket|tournament|world cup|box office)/.test(text)) type = "irrelevant";
  const foreign = FOREIGN_HINT.test(text);
  const domestic = DOMESTIC.test(text) && !/gift city|\bifsc/.test(text);
  if ((type === "entry" || type === "exit") && (!foreign || domestic)) type = "irrelevant";
  if (type === "fund_launch" && (!LAUNCH_SCOPE.test(text) || domestic || (DOMESTIC_FUND.test(text) && !/gift city|\bifsc/.test(text)))) type = "irrelevant";
  if (type === "relocation" && !/fund|asset manager|investment manager|aif|fpi/.test(text)) type = "irrelevant";

  // Two-sided stories: a stake sold *to* someone is also that buyer's investment, and so on.
  const types = type === "irrelevant" ? [] : [type];
  if (type === "exit" && /(\bsells?\b|\bsold\b|offloads?|divests?|stake sale).{0,80}\bto\b/.test(text)) types.push("entry");
  if (type === "entry" && /(acquires?|\bbuys?\b|\bbought\b|picks? up).{0,80}\bfrom\b/.test(text) && foreign) types.push("exit");
  if (type === "relocation" && RULES[1][1].test(text)) types.push("fund_launch");

  const first = type === "irrelevant" ? null : guessInvestor(item.title);
  const parties: Party[] = [];
  if (first) parties.push({ name: first, role: type === "exit" ? "seller" : type === "entry" ? "investor" : "fund", type: null });
  if (types.includes("exit") && types.includes("entry")) {
    // The counterparty is a name: the last "to X" / "from X" where X starts with a capital letter.
    const re = type === "exit" ? /\bto\s+([A-Z][^,;:|]*?)(?=\s+(?:for|at|in|via|amid|as|to)\b|[,;:|]|$)/g : /\bfrom\s+([A-Z][^,;:|]*?)(?=\s+(?:for|at|in|via|amid|as|to)\b|[,;:|]|$)/g;
    const other = [...item.title.matchAll(re)].pop()?.[1]?.trim();
    // A domestic buyer's purchase is not a foreign investment: keep only the exit side then.
    if (type === "exit" && (!other || !FOREIGN_HINT.test(other.toLowerCase()))) types.splice(types.indexOf("entry"), 1);
    else if (other && other.split(/\s+/).length <= 6) parties.push({ name: other, role: type === "exit" ? "buyer" : "seller", type: null });
    if (type === "entry" && parties[0]) parties[0].role = "buyer";
  }

  const amt = parseAmount(`${item.title} ${item.summary}`);
  let priority = PRIORITY[type] ?? 0;
  if (/gift city|ifsca|ifsc\b/.test(text) && priority > 0) priority = Math.min(5, priority + 1);
  return {
    relevant: type !== "irrelevant",
    event_type: type,
    event_types: types.length ? types : null,
    parties: parties.length ? parties : null,
    investor: first,
    investor_type: null,
    investor_country: null,
    origin_jurisdiction: type === "relocation"
      ? (text.match(/\b(dubai|difc|adgm|abu dhabi|singapore|mauritius|cayman|luxembourg|ireland|gift city)\b/) || [])[1] ?? null
      : null,
    target: null,
    sector: null,
    amount_usd_m: amt.usd_m,
    amount_text: amt.text,
    priority,
    confidence: 0.4,
    summary: null,
  };
}

// ---------------------------------------------------------------------------
// LLM: much better at investor/target extraction and ambiguous wording
// ("final close" vs "closing the fund"). Used when ANTHROPIC_API_KEY is set.
// ---------------------------------------------------------------------------

const SYSTEM = `You filter and classify news for a business-development team at an Indian global custodian bank. They onboard foreign investors (FPIs, foreign PE/VC funds, sovereign and pension funds) and GIFT City (IFSC) funds that invest in India, and use this feed to find firms to contact.

Keep an item (relevant=true) ONLY if it is clearly one of these four:
- entry: a foreign or offshore investor puts money into India: buys a stake in an Indian company, anchors or subscribes to an Indian IPO/QIP/block deal, leads or joins a funding round in an Indian company, acquires an Indian business or asset, or announces a concrete commitment/plan to invest a stated amount in India.
- exit: a foreign or offshore investor exits an investment in an Indian company, in full or in part (block deal sale, OFS, secondary sale, stake reduction), even if it keeps other Indian investments; a foreign company closes, sells or winds down its Indian operations or business (e.g. a foreign retailer shutting its Indian stores); or a fund that invests in India is liquidated, wound down, merged away or delisted, or a foreign fund manager closes its India operations.
- fund_launch: a fund or investment vehicle set up OUTSIDE India that will invest in India: India-focused funds, ETFs or UCITS launched abroad, offshore feeder funds, GIFT City (IFSC) fund launches (GIFT City counts as offshore), new FPI registrations of foreign funds, IFSCA fund-management licences, and first/final closes of such offshore funds ("final close" means fundraising completed, NOT shutting down). Funds domiciled in India (SEBI-registered AIFs, onshore private equity / venture / credit funds, mutual fund schemes) are NOT fund_launch: set relevant=false for them.
- relocation: a fund or fund manager that invests in India changes jurisdiction or domicile, in either direction (e.g. Dubai/DIFC/ADGM, Singapore, Mauritius or Cayman to GIFT City, or GIFT City to Abu Dhabi), including restructuring into feeders.

Set relevant=false for everything else, including: domestic-only activity (an Indian mutual fund, Indian promoter or Indian investor buying or selling Indian stocks; Indian mutual fund NFOs and new retail mutual fund schemes; IPO subscription and GMP coverage without a named foreign investor); aggregate FPI flow figures or market commentary; investments outside India; Indian companies investing abroad; policy news without a named investor or fund; opinion and explainers. When in doubt, set relevant=false.

priority (1-5) for kept items, as a lead for a custodian:
5 = relocation, or a new FPI/IFSCA registration
4 = offshore or GIFT City fund launch or fund close for India; a foreign investor's first investment in India
3 = any other foreign investment into India
2 = exit or wind-down

Extract names exactly as written. investor = the foreign investor / fund / fund manager (not the Indian target). investor_type one of: fpi, pe_vc, sovereign, pension, strategic, asset_manager, hedge_fund, family_office, bank, other. investor_country = its home country if stated or well known. origin_jurisdiction only for relocation: write it as "From -> To" (e.g. "DIFC -> GIFT City"). target = the Indian company or asset. amount_usd_m = deal or fund size in USD millions if stated (1 crore = 10,000,000 INR; use ${INR_PER_USD} INR/USD). summary = one plain sentence, max 25 words, saying who did what in India.`;

const nullable = (type: string) => ({ type: [type, "null"] });

const SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          relevant: { type: "boolean" },
          event_type: {
            type: "string",
            enum: ["entry", "exit", "fund_launch", "relocation"],
          },
          investor: nullable("string"),
          investor_type: nullable("string"),
          investor_country: nullable("string"),
          origin_jurisdiction: nullable("string"),
          target: nullable("string"),
          sector: nullable("string"),
          amount_usd_m: nullable("number"),
          priority: { type: "integer" },
          confidence: { type: "number" },
          summary: nullable("string"),
        },
        required: [
          "i", "relevant", "event_type", "investor", "investor_type", "investor_country",
          "origin_jurisdiction", "target", "sector", "amount_usd_m", "priority", "confidence", "summary",
        ],
        additionalProperties: false,
      },
    },
  },
  required: ["items"],
  additionalProperties: false,
};

export async function classifyLLM(
  client: Anthropic,
  model: string,
  batch: RawItem[],
): Promise<Map<string, Classified> | null> {
  const lines = batch.map((it, i) =>
    `[${i}] (${it.source_name}) ${it.title}${it.summary ? ` — ${it.summary.slice(0, 300)}` : ""}`
  ).join("\n");

  const response = await client.beta.messages.create({
    model,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    // @ts-ignore: newer request fields may be missing from the SDK's types
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
    system: SYSTEM,
    messages: [{ role: "user", content: `Classify each item. Return one entry per index.\n\n${lines}` }],
  });

  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  const parsed = JSON.parse(text) as { items: (Omit<Classified, "amount_text" | "event_types" | "parties"> & { i: number })[] };

  const out = new Map<string, Classified>();
  for (const r of parsed.items) {
    const item = batch[r.i];
    if (!item) continue;
    const amt = parseAmount(`${item.title} ${item.summary}`);
    out.set(item.key, {
      ...r,
      event_type: r.relevant ? r.event_type : "irrelevant",
      event_types: r.relevant ? [r.event_type] : null,
      parties: r.relevant && r.investor ? [{ name: r.investor, role: r.event_type === "exit" ? "seller" : "investor", type: r.investor_type }] : null,
      priority: r.relevant ? Math.max(0, Math.min(5, r.priority)) : 0,
      amount_text: amt.text,
    });
  }
  return out;
}
