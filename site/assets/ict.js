// Shared shell for the public pages: header, footer, theme toggle, and data helpers. No build step.
(function () {
  const SB = "https://urpphqybqmxlwhjghsmf.supabase.co", KEY = "sb_publishable_zSo8W_FfT_fZEcfMWoumOw_Yv9mmVWB";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // Indian digit grouping (12,34,567) with a true minus sign.
  const inr = (n) => { const a = Math.abs(Math.round(n)), s = String(a); const g = s.length > 3 ? s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + s.slice(-3) : s; return (n < 0 ? "−" : "") + g; };
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  async function api(path, opts) {
    const init = { ...(opts || {}), headers: { apikey: KEY, "Content-Type": "application/json" } };
    for (const base of ["/sb/rest/v1/", SB + "/rest/v1/"]) {
      try { const r = await fetch(base + path, init); if (r.ok || r.status === 206) return await r.json(); } catch (e) {}
    }
    throw new Error("data unavailable");
  }
  const NAV = [["Markets", "/app"], ["Investing in India", "/rules.html"], ["Regulation", "/app?tab=regulation"], ["Methodology", "/methodology.html"]];
  function shell(current) {
    const t = localStorage.getItem("ict-theme"); if (t) document.documentElement.dataset.theme = t;
    const hdr = `<a class="skip" href="#main">Skip to content</a>
<div class="util"><div class="in"><span>Independent research. Not affiliated with any bank, employer or regulator.</span><span><a href="/methodology.html">Methodology &amp; sources</a></span></div></div>
<header class="hdr"><div class="in"><a class="logo" href="/">India Capital <b>Tracker</b></a>
<nav class="nav" id="nav" aria-label="Main">${NAV.map(([l, h]) => `<a href="${h}"${h === current ? ' aria-current="page"' : ""}>${l}</a>`).join("")}</nav>
<button class="tgl" id="tgl" aria-label="Switch light or dark theme">Theme</button><a class="btn p" href="/app">Open dashboard</a>
<button class="tgl menu" id="mn" aria-label="Menu" aria-expanded="false">Menu</button></div></header>`;
    const ftr = `<footer class="ftr"><div class="in"><div><b style="color:#fff;font-size:15px">India Capital Tracker</b><p>Foreign capital into and out of India: flows, deals, registrations and rules, traced to primary sources.</p></div>
<div><h4>Product</h4><ul><li><a href="/app">Dashboard</a></li><li><a href="/rules.html">Rulebook</a></li><li><a href="/methodology.html">Methodology</a></li></ul></div>
<div><h4>Sources</h4><ul><li>NSDL, NSE, BSE</li><li>SEBI, RBI, CCIL</li><li>DPIIT, IFSCA, CCI</li></ul></div>
<div><h4>Legal</h4><ul><li><a href="/disclaimer.html">Disclaimer</a></li><li><a href="/privacy.html">Privacy</a></li><li><a href="/terms.html">Terms</a></li></ul></div>
<div class="legal">For information only. Not investment, legal or tax advice. Reported items (grade C) are unverified; check the original source before relying on them. Headlines and links belong to their publishers.</div></div></footer>`;
    document.body.insertAdjacentHTML("afterbegin", hdr); document.body.insertAdjacentHTML("beforeend", ftr);
    document.getElementById("tgl").onclick = () => { const d = document.documentElement, dark = d.dataset.theme ? d.dataset.theme === "dark" : matchMedia("(prefers-color-scheme:dark)").matches; d.dataset.theme = dark ? "light" : "dark"; try { localStorage.setItem("ict-theme", d.dataset.theme); } catch (e) {} };
    const mn = document.getElementById("mn"); mn.onclick = () => { const o = document.getElementById("nav").classList.toggle("open"); mn.setAttribute("aria-expanded", o); };
  }
  window.ICT = { api, esc, inr, safeUrl, shell };
})();
