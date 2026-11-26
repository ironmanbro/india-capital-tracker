// WCAG 2.1 A/AA and best-practice scan (axe-core) of every page in the dark and light themes. Any violation fails the run.
const fs = require("fs"), path = require("path"), { chromium } = require("playwright");
const { TABS, STATIC_PAGES, serve } = require("./lib");
const axeSrc = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
(async () => {
  const { srv, base } = await serve(); const browser = await chromium.launch(); let total = 0;
  for (const scheme of ["dark", "light"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme }); const page = await ctx.newPage();
    const urls = [...TABS.map((t) => `/?tab=${t}`), ...STATIC_PAGES.map((f) => `/${f}`)];
    for (const u of urls) {
      await page.goto(base + u, { waitUntil: "load" }).catch(() => {}); await page.waitForTimeout(u.includes("markets") ? 10000 : 6500);
      if (scheme === "light") { await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light")); await page.waitForTimeout(500); }
      await page.waitForTimeout(2500); await page.addScriptTag({ content: axeSrc });
      const v = await page.evaluate(async () => (await axe.run(document, { resultTypes: ["violations"], runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] } })).violations.map((x) => ({ id: x.id, impact: x.impact, n: x.nodes.length, help: x.help, eg: x.nodes.slice(0, 2).map((n) => n.target.join(" ")) })));
      total += v.reduce((a, x) => a + x.n, 0);
      console.log(`${scheme.padEnd(5)} ${u.padEnd(22)} ${v.length ? v.map((x) => `${x.id}(${x.n})`).join(" ") : "ok"}`);
      v.forEach((x) => console.error(`   ${x.impact} ${x.id}: ${x.help} e.g. ${x.eg.join(" ; ")}`));
    }
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(total ? `${total} accessibility violation(s)` : "accessibility scan passed"); process.exit(total ? 1 : 0);
})();
