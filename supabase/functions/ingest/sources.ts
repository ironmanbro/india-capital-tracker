// What we search for. Each query becomes one Google News RSS feed.
// `tag` is stored with the event so you can see which search found it.

// `region` marks searches and feeds aimed at investors from one part of the world; their items must pass the
// India filter below before they are stored, and keep the region tag so the Feed can filter by it.
export type NewsQuery = { tag: string; q: string; edition: "IN" | "US"; region?: string };

export const NEWS_QUERIES: NewsQuery[] = [
  // --- Entries: foreign money coming into India ---
  { tag: "entry", q: `"invests in" India foreign fund stake`, edition: "IN" },
  { tag: "entry", q: `"picks up stake" OR "acquires stake" India foreign investor`, edition: "IN" },
  { tag: "entry", q: `"block deal" FPI buys stake`, edition: "IN" },
  { tag: "entry", q: `"bulk deal" foreign fund buys`, edition: "IN" },
  { tag: "entry", q: `"anchor investors" IPO foreign funds`, edition: "IN" },
  { tag: "entry", q: `QIP allotment foreign institutional investors`, edition: "IN" },
  { tag: "entry", q: `"sovereign wealth fund" India investment`, edition: "IN" },
  { tag: "entry", q: `"pension fund" invests India`, edition: "IN" },
  { tag: "entry", q: `"private equity" invests India deal`, edition: "IN" },
  { tag: "entry", q: `"CCI approves" acquisition stake`, edition: "IN" },
  { tag: "entry", q: `India investment "first investment in India"`, edition: "US" },

  // --- Exits: foreign investors selling Indian stakes ---
  { tag: "exit", q: `"stake sale" India foreign investor exits`, edition: "IN" },
  { tag: "exit", q: `"offloads stake" OR "sells stake" block deal`, edition: "IN" },
  { tag: "exit", q: `"private equity" exit India stake`, edition: "IN" },
  { tag: "exit", q: `"offer for sale" promoter foreign parent stake`, edition: "IN" },
  { tag: "exit", q: `"exits India" company OR fund`, edition: "IN" },

  // --- New funds, fundraises, launches ---
  { tag: "fund", q: `"India-focused fund"`, edition: "IN" },
  { tag: "fund", q: `"India-focused fund"`, edition: "US" },
  { tag: "fund", q: `"India fund" launch`, edition: "US" },
  { tag: "fund", q: `"India ETF" launch`, edition: "US" },
  { tag: "fund", q: `"final close" fund India`, edition: "IN" },
  { tag: "fund", q: `"first close" fund India`, edition: "IN" },
  { tag: "fund", q: `"GIFT City" fund launch`, edition: "IN" },
  { tag: "fund", q: `"Category III AIF" launch`, edition: "IN" },
  { tag: "fund", q: `"fund management entity" IFSCA`, edition: "IN" },
  { tag: "fund", q: `FPI licence OR "FPI registration" SEBI fund`, edition: "IN" },

  // --- Wind-downs / closures ---
  { tag: "wind_down", q: `India fund liquidate OR "wind down" OR liquidation`, edition: "US" },
  { tag: "wind_down", q: `"India ETF" close OR liquidate OR delist`, edition: "US" },
  { tag: "wind_down", q: `fund "wind down" India operations`, edition: "IN" },

  // --- Jurisdiction moves (Dubai / Singapore / Mauritius -> GIFT City) ---
  { tag: "relocation", q: `"GIFT City" relocate OR shift OR redomicile fund`, edition: "IN" },
  { tag: "relocation", q: `"GIFT City" Dubai OR DIFC OR ADGM fund`, edition: "IN" },
  { tag: "relocation", q: `DIFC OR ADGM "India" fund manager GIFT`, edition: "US" },
  { tag: "relocation", q: `Mauritius fund restructure India treaty GIFT City`, edition: "IN" },
  { tag: "relocation", q: `Singapore fund relocate "GIFT City"`, edition: "IN" },
  { tag: "relocation", q: `IFSCA approval fund relocation`, edition: "IN" },

  // --- Planning / intent ---
  { tag: "planning", q: `"plans to invest" India billion fund`, edition: "IN" },
  { tag: "planning", q: `"to invest" India "$" billion global investor`, edition: "US" },
  { tag: "planning", q: `"India allocation" fund increase`, edition: "US" },

  // --- More launch / move coverage ---
  { tag: "fund", q: `"GIFT City" fund "India" launch OR registers OR licence`, edition: "US" },
  { tag: "relocation", q: `fund "India" redomicile OR relocate OR "shift base"`, edition: "US" },

  // --- Outbound: Indian companies investing abroad ---
  { tag: "outbound", q: `"overseas direct investment" India`, edition: "IN" },
  { tag: "outbound", q: `Indian company acquires "UK-based" OR "US-based" OR "Germany-based" firm`, edition: "IN" },
  { tag: "outbound", q: `Indian firm "overseas subsidiary" OR "overseas acquisition" invest`, edition: "IN" },

  // --- Foreign investors and hubs: each query names India, and items keep a region tag ---
  { tag: "foreign", region: "gulf", q: `ADIA OR Mubadala OR "Public Investment Fund" OR "Qatar Investment Authority" OR "Kuwait Investment Authority" OR ADQ India`, edition: "IN" },
  { tag: "foreign", region: "japan", q: `MUFG OR SMBC OR Mizuho OR "Japanese investor" India stake OR invest`, edition: "IN" },
  { tag: "foreign", region: "korea", q: `site:kedglobal.com India`, edition: "US" },
  { tag: "foreign", region: "singapore", q: `GIC OR Temasek OR "Singapore fund" India stake OR invest`, edition: "IN" },
  { tag: "foreign", region: "hubs", q: `"GIFT City" Mauritius OR Singapore OR DIFC OR ADGM fund domicile OR relocate`, edition: "IN" },
  { tag: "foreign", region: "global", q: `India funds AIFMD OR NISA OR "US tax" OR "tax treaty" foreign investors`, edition: "US" },
];

// Direct RSS from foreign outlets: general feeds, so only items that pass the India filter are kept.
export const RSS_FEEDS = [
  { name: "Nikkei Asia", region: "japan", url: "https://asia.nikkei.com/rss/feed/nar" },
  { name: "The Edge Singapore", region: "singapore", url: "https://www.theedgesingapore.com/rss.xml" },
  { name: "The National", region: "gulf", url: "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml" },
];

// Foreign-source items must be about India AND about money moving: off-topic global stories never reach review.
const INDIA_WORDS = /\b(india|indian|indias|gift city|gift ifsc|ifsc|sensex|nifty|mumbai|bengaluru|bangalore|new delhi|rupee|reliance|tata|adani|infosys|hdfc|icici)\b/i;
const CAPITAL_WORDS = /(invest|stake|fund|acqui|deal|\bipo\b|capital|bond|equit|sovereign|allocat|inflow|outflow|exposure|portfolio|\bfpis?\b|\bfdi\b|aifmd|\bnisa\b|\btax\b|treaty|domicil|relocat|\bbuys?\b|\bsells?\b|\bexits?\b|listing|lender|loan)/i;
export const indiaCapital = (text: string) => INDIA_WORDS.test(text) && CAPITAL_WORDS.test(text);

// `time` is a Google News time operator: "when:1d", or "after:2026-04-01 before:2026-04-08" for history.
export function googleNewsUrl(q: NewsQuery, time: string) {
  const query = `${q.q} ${time}`;
  const loc = q.edition === "IN"
    ? "hl=en-IN&gl=IN&ceid=IN:en"
    : "hl=en-US&gl=US&ceid=US:en";
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${loc}`;
}

export const NSE_FILES = [
  { source: "nse_bulk", url: "https://nsearchives.nseindia.com/content/equities/bulk.csv" },
  { source: "nse_block", url: "https://nsearchives.nseindia.com/content/equities/block.csv" },
  // BSE deal CSV addresses were not verified from the build environment; set the env vars to enable them.
  ...[["bse_bulk", "BSE_BULK_URL"], ["bse_block", "BSE_BLOCK_URL"]]
    .map(([source, env]) => ({ source, url: Deno.env.get(env) ?? "" })).filter((f) => f.url),
];


// NSE's RSS feed of shareholding-pattern filings (listed at nseindia.com/rss-feed). The address could not be
// checked from the build environment; set SHP_FEED_URL to override it without a code change.
export const SHP_FEED = Deno.env.get("SHP_FEED_URL") ?? "https://nsearchives.nseindia.com/content/RSS/Shareholding_Pattern.xml";
