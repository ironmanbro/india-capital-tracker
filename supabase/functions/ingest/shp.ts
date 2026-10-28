// Shareholding patterns from NSE's RSS feed: for each new filing, read its XBRL file and keep the named
// foreign holders with 1% or more. NSE publishes the feed for programs to poll; only the files it links to
// are fetched, a few per run. Rows are marked source "nse_rss" (the owner's reviewed uploads are "upload").

export type ShpRow = { holder: string; pct: number; shares: number | null; category: string; foreign: boolean };
export type ShpFile = { company: string; symbol: string; period_end: string; rows: ShpRow[] };
export type FeedItem = { title: string; link: string; date: string | null; xbrl: string | null };

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, "&").trim();
const tag = (xml: string, name: string) => decode((xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`)) || [])[1] ?? "");

// The XBRL link may be the item's link or sit in its description, depending on the feed.
export function parseFeed(xml: string): FeedItem[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, it]) => {
    const link = tag(it, "link"), desc = tag(it, "description");
    const urls = [link, ...(desc.match(/https?:\/\/[^\s"'<>]+/g) || [])];
    const xbrl = urls.find((u) => /\.(xml|xbrl)(\?|$)/i.test(u) || /xbrl/i.test(u)) ?? null;
    const d = new Date(tag(it, "pubDate"));
    return { title: tag(it, "title"), link, date: isNaN(+d) ? null : d.toISOString(), xbrl };
  });
}

// Same reading as the site's upload panel, without a DOM: facts are grouped by context, and a context with a
// shareholder name and a percentage is one holder. Element names differ between taxonomy versions, so they
// are matched by pattern.
export function parseShp(xml: string, foreignNames: RegExp, domesticNames: RegExp): ShpFile {
  const ctx = new Map<string, { period: string; dims: string }>();
  for (const [, id, body] of xml.matchAll(/<(?:\w+:)?context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/(?:\w+:)?context>/g)) {
    const period = (body.match(/<(?:\w+:)?(?:instant|endDate)>([^<]+)</) || [])[1]?.trim() ?? "";
    const dims = [...body.matchAll(/<(?:\w+:)?(?:explicit|typed)Member\b[^>]*dimension="([^"]*)"[^>]*>([\s\S]*?)<\/(?:\w+:)?(?:explicit|typed)Member>/g)]
      .map(([, d, v]) => `${d} ${v.replace(/<[^>]+>/g, "").trim()}`).join(" ");
    ctx.set(id, { period, dims });
  }
  const facts = new Map<string, Record<string, string>>();
  for (const [, name, ref, val] of xml.matchAll(/<(?:[\w-]+:)?(\w+)\b[^>]*\bcontextRef="([^"]+)"[^>]*>([\s\S]*?)<\/(?:[\w-]+:)?\1>/g)) {
    const v = decode(val);
    if (!v) continue;
    if (!facts.has(ref)) facts.set(ref, {});
    facts.get(ref)![name] = v;
  }
  const pick = (g: Record<string, string>, ...res: RegExp[]) => { for (const re of res) for (const k in g) if (re.test(k)) return g[k]; return ""; };
  const any = (...res: RegExp[]) => { for (const re of res) for (const g of facts.values()) for (const k in g) if (re.test(k)) return g[k]; return ""; };
  let rows: ShpRow[] = [];
  facts.forEach((g, ref) => {
    const holder = pick(g, /^NameOf(The)?Shareholders?$/i, /NameOf(The)?Shareholder|ShareholderName/i);
    const pct = parseFloat(pick(g, /ShareholdingAsAPercentage|AsAPercentageOfTotal/i, /Percent/i));
    if (!holder || !Number.isFinite(pct)) return;
    const shares = parseFloat(pick(g, /^NumberOfFullyPaidUpEquityShares/i, /TotalNumberOfShares|NumberOfShares/i).replace(/,/g, ""));
    const where = `${ref} ${ctx.get(ref)?.dims ?? ""}`.replace(/Member\b/g, "").replace(/([a-z])([A-Z])/g, "$1 $2");
    const category = where.replace(/[^A-Za-z]+/g, " ").match(/foreign portfolio[a-z ]*|foreign[a-z ]*|insurance[a-z ]*|mutual fund[a-z ]*|bodies corporate|promoter[a-z ]*|individual[a-z ]*/i)?.[0].trim() ?? "";
    // The context says where the holder is listed; a foreign-looking name is a fallback for files whose
    // contexts carry no category.
    const foreign = /foreign|fpi|fii|overseas/i.test(where) || (!category && foreignNames.test(holder) && !domesticNames.test(holder));
    rows.push({ holder, pct, shares: Number.isFinite(shares) ? shares : null, category, foreign });
  });
  if (rows.length && rows.every((r) => r.pct <= 1)) rows = rows.map((r) => ({ ...r, pct: +(r.pct * 100).toFixed(4) }));
  const periods = [...ctx.values()].map((c) => c.period).filter(Boolean).sort();
  const date = any(/DateOfReport|PeriodEnd|QuarterEnd|ShareholdingPatternAsOn/i) || periods[periods.length - 1] || "";
  return {
    company: any(/^NameOfTheCompany$|NameOfTheListedEntity|^NameOfCompany$/i, /CompanyName|EntityName/i),
    symbol: any(/^Symbol$|NSESymbol|ScripSymbol/i, /ScripCode/i),
    period_end: /^\d{4}-\d{2}-\d{2}/.test(date) ? date.slice(0, 10) : "",
    rows: rows.filter((r) => r.pct >= 1).sort((a, b) => b.pct - a.pct),
  };
}
