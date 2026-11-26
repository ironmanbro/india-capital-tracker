// Every inline <script> in every page must parse. (A stray character can silently stop the whole app from starting.)
const fs = require("fs"), path = require("path"), os = require("os"), { spawnSync } = require("child_process");
const { ROOT } = require("./lib");
let bad = 0, scripts = 0;
for (const f of fs.readdirSync(ROOT).filter((x) => x.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(ROOT, f), "utf8");
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g; let m, i = 0;
  while ((m = re.exec(html))) {
    if (!m[1].trim()) continue;
    const tmp = path.join(os.tmpdir(), `ict-${process.pid}-${f}-${i++}.js`); fs.writeFileSync(tmp, m[1]); scripts++;
    const r = spawnSync(process.execPath, ["--check", tmp], { encoding: "utf8" }); fs.unlinkSync(tmp);
    if (r.status !== 0) { bad++; console.error(`SYNTAX ERROR in ${f} (script ${i}):\n${r.stderr.split("\n").slice(0, 6).join("\n")}`); }
  }
}
console.log(`${scripts} inline scripts checked, ${bad} with errors`);
process.exit(bad ? 1 : 0);
