// Opens every page at desktop and phone width and fails on: a script error, sideways scrolling, a missing page title or heading,
// or a missing/duplicated main landmark. Data comes from the live public database, so a slow reply is not a failure; a script error is.
const { chromium } = require("playwright");
const { TABS, STATIC_PAGES, serve } = require("./lib");
(async () => {
  const { srv, base } = await serve(); const browser = await chromium.launch(); const fails = [];
  const note = (m) => { fails.push(m); console.error("FAIL " + m); };
  for (const [label, width] of [["desktop", 1440], ["phone", 390]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } }); const page = await ctx.newPage();
    const errors = []; page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
    for (const t of TABS) {
      errors.length = 0;
      await page.goto(`${base}/?tab=${t}`, { waitUntil: "load" }).catch(() => {}); await page.waitForTimeout(t === "markets" ? 9000 : 6000);
      const r = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth, h1: document.querySelector("h1")?.textContent.trim(), mains: document.querySelectorAll("main").length, title: document.title }));
      if (errors.length) note(`${label} ${t}: script error: ${errors[0]}`);
      if (r.over) note(`${label} ${t}: page scrolls sideways`);
      if (!r.h1) note(`${label} ${t}: no page heading`);
      if (r.mains !== 1) note(`${label} ${t}: expected one <main>, found ${r.mains}`);
      if (!r.title) note(`${label} ${t}: no document title`);
      console.log(`${label.padEnd(7)} ${t.padEnd(10)} ${r.h1 || "?"}`);
    }
    for (const f of STATIC_PAGES) {
      errors.length = 0; await page.goto(`${base}/${f}`, { waitUntil: "load" }).catch(() => {}); await page.waitForTimeout(1500);
      const r = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth, h1: !!document.querySelector("h1"), title: document.title }));
      if (errors.length) note(`${label} ${f}: script error: ${errors[0]}`); if (r.over) note(`${label} ${f}: page scrolls sideways`); if (!r.h1 || !r.title) note(`${label} ${f}: missing heading or title`);
    }
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log(fails.length ? `${fails.length} problem(s)` : "smoke test passed"); process.exit(fails.length ? 1 : 0);
})();
