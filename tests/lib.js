// Shared helpers: a tiny static server for site/ and the list of pages (tabs) the checks visit.
const http = require("http"), fs = require("fs"), path = require("path");
const ROOT = path.resolve(__dirname, "..", "site");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const TABS = ["overview", "feed", "investors", "network", "directory", "gift", "flows", "markets", "odi", "regulation"];
// Static pages that must open and carry the shared legal/about content.
const STATIC_PAGES = ["about.html", "rules.html", "privacy.html", "terms.html", "disclaimer.html"];

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split("?")[0]); if (p === "/") p = "/index.html";
      let f = path.join(ROOT, p); if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      if (!fs.existsSync(f) && fs.existsSync(f + ".html")) f += ".html";
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}
module.exports = { ROOT, TABS, STATIC_PAGES, serve };
