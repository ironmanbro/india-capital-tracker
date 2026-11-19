"""NSE end-of-day closes, index closes and corporate actions, cached on disk so a refresh only fetches what is new.

Sources (all NSE):
  * bhavcopy   https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_DDMMYYYY.csv   closes of every listed share
  * indices    https://nsearchives.nseindia.com/content/indices/ind_close_all_DDMMYYYY.csv       closes of Nifty 500 and Nifty 50
  * actions    NSE's bhavcopy MCP server, tool get_corporate_actions                                exact ex-dates and adjustment factors
Rules that matter for accuracy:
  * On a day with no trading NSE's archive serves the PREVIOUS trading day's file under the new name (26-Jan-2026 returned 23-Jan data).
    So every file is accepted only if the date written INSIDE it equals the date asked for.
  * A "no file for that day" answer is remembered only for dates old enough to be final; for recent days it may just be unpublished.
  * Prices are unadjusted; adjust() applies the corporate-action factors between two dates.
The cache lives in pipeline/site_v2/cache/ (committed; it holds closes for the shares in the deal files only)."""
import csv, datetime as dt, io, json, os, time, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(HERE, "cache"); os.makedirs(CACHE, exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0"}
BHAV = "https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_%s.csv"
IDX = "https://nsearchives.nseindia.com/content/indices/ind_close_all_%s.csv"
MCP = "https://mcp.nseindia.in/bhavcopy/cm/mcp"
FINAL_AFTER_DAYS = 5          # a missing file for a date older than this is a real non-trading day

def _load(name, default):
    try: return json.load(open(os.path.join(CACHE, name), encoding="utf-8"))
    except (OSError, ValueError): return default
def _save(name, obj):
    tmp = os.path.join(CACHE, name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f: json.dump(obj, f, separators=(",", ":"), sort_keys=True)
    os.replace(tmp, os.path.join(CACHE, name))

def _get(url, tries=3):
    last = None
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r: return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code == 404: return None          # no such file; a 403 (blocked) is an error, never "no trading"
            last = e
        except Exception as e: last = e      # noqa: BLE001
        time.sleep(1.5 * (i + 1))
    raise RuntimeError(f"fetch failed: {url} ({last})")

class Prices:
    """days: {iso: 1 (traded) | 0 (no trading)}, close: {SYMBOL: {iso: close}}, idx: {iso: {"n500": x, "n50": y}}"""
    def __init__(self, symbols, budget=400):
        self.symbols = set(symbols); self.budget = budget; self.fetched = 0; self.errors = 0
        self.days = _load("days.json", {}); self.close = _load("closes.json", {}); self.idx = _load("index.json", {})
        self.today = dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))).date()

    def save(self): _save("days.json", self.days); _save("closes.json", self.close); _save("index.json", self.idx)

    def _fetch_day(self, d):
        """True traded / False not traded / None unknown (budget spent or fetch error: nothing is remembered)."""
        iso = d.isoformat()
        if iso in self.days: return bool(self.days[iso])
        if d.weekday() >= 5: self.days[iso] = 0; return False
        if self.fetched >= self.budget: return None
        k = d.strftime("%d%m%Y"); self.fetched += 1
        if self.fetched % 40 == 0: self.save(); print(f"  price files fetched: {self.fetched} (at {iso})", flush=True)
        try:
            txt = _get(BHAV % k)
            itxt = _get(IDX % k)
        except RuntimeError: self.errors += 1; return None
        ok = False
        if txt:
            rows = list(csv.reader(io.StringIO(txt)))
            hdr = [h.strip().upper() for h in rows[0]]
            try: iS, iD, iC, iSe = hdr.index("SYMBOL"), hdr.index("DATE1"), hdr.index("CLOSE_PRICE"), hdr.index("SERIES")
            except ValueError: self.errors += 1; return None          # not the file we expected (an error page): remember nothing
            inside = {r[iD].strip() for r in rows[1:6]}
            ok = inside == {d.strftime("%d-%b-%Y")} or {x.upper() for x in inside} == {d.strftime("%d-%b-%Y").upper()}
            if ok:
                best = {}
                for r in rows[1:]:
                    s = r[iS].strip()
                    if s not in self.symbols: continue
                    try: c = float(r[iC])
                    except ValueError: continue
                    if s not in best or r[iSe].strip() == "EQ": best[s] = c
                for s, c in best.items(): self.close.setdefault(s, {})[iso] = c
        if ok and itxt:
            ir = list(csv.reader(io.StringIO(itxt))); h = [x.strip() for x in ir[0]]
            try: iN, iDt, iV = h.index("Index Name"), h.index("Index Date"), h.index("Closing Index Value")
            except ValueError: self.errors += 1; return None
            got = {}
            for r in ir[1:]:
                if r[iN].strip() in ("Nifty 500", "Nifty 50") and r[iDt].strip() == d.strftime("%d-%m-%Y"):
                    try: got["n500" if r[iN].strip() == "Nifty 500" else "n50"] = float(r[iV])
                    except ValueError: pass
            if got: self.idx[iso] = got
        if ok: self.days[iso] = 1; return True
        if (self.today - d).days > FINAL_AFTER_DAYS: self.days[iso] = 0
        return False

    def on_or_after(self, d, limit=7):
        """First trading day on or after d that has data, or None if it is in the future / not yet published / not fetched."""
        for i in range(limit + 1):
            x = d + dt.timedelta(days=i)
            if x > self.today: return None
            t = self._fetch_day(x)
            if t is None: return None
            if t: return x
        return None

    def on_or_before(self, d, limit=7):
        for i in range(limit + 1):
            x = d - dt.timedelta(days=i); t = self._fetch_day(x)
            if t is None: return None
            if t: return x
        return None

    def px(self, sym, d): return (self.close.get(sym) or {}).get(d.isoformat())
    def bench(self, d): return (self.idx.get(d.isoformat()) or {}).get("n500")

# ---- corporate actions via NSE's MCP server
class Actions:
    def __init__(self, budget=250, stale_days=20):
        self.data = _load("actions.json", {}); self.budget = budget; self.stale = stale_days; self.calls = 0; self.sid = None
        self.today = dt.date.today()

    def _rpc(self, body):
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", **UA}
        if self.sid: h["Mcp-Session-Id"] = self.sid
        r = urllib.request.urlopen(urllib.request.Request(MCP, data=json.dumps(body).encode(), headers=h), timeout=60)
        t = r.read().decode(); self.sid = r.headers.get("Mcp-Session-Id") or self.sid
        return json.loads(t[t.index("data:") + 5:] if "data:" in t else t)

    def _init(self):
        if not self.sid: self._rpc({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "india-capital-tracker", "version": "1"}}})

    def need(self, sym):
        e = self.data.get(sym)
        return e is None or (self.today - dt.date.fromisoformat(e["at"])).days > self.stale

    def refresh(self, symbols, since="2025-01-01"):
        todo = [s for s in symbols if self.need(s)][: self.budget]
        for s in todo:
            try:
                self._init(); self.calls += 1
                j = self._rpc({"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "get_corporate_actions", "arguments": {"symbol": s, "fromDate": since, "toDate": (self.today + dt.timedelta(days=400)).isoformat()}}})
                r = json.loads(j["result"]["content"][0]["text"])
                if not isinstance(r, dict) or r.get("error") or "actions" not in r: continue      # never treat a failed lookup as "no actions"
                self.data[s] = {"at": self.today.isoformat(), "partial": bool(r.get("warning")),
                                "a": [[a["exDate"], a["actionType"], a["adjustmentFactor"], a.get("purpose", "")[:90]] for a in r["actions"] if a["actionType"] in ("SPLIT", "BONUS") or a["adjustmentFactor"] != 1.0 or a["actionType"] not in ("DIVIDEND", "OTHER")]}
            except Exception: continue      # noqa: BLE001
            if self.calls % 60 == 0: _save("actions.json", self.data); print(f"  corporate-action lookups: {self.calls}/{len(todo)}", flush=True)
            time.sleep(0.1)
        _save("actions.json", self.data)
        return len(todo)

    def factor(self, sym, d0, d1):
        """Multiply the price at d0 by this to compare it with the price at d1 (events with d0 < ex-date <= d1). None if the symbol's actions are unknown."""
        e = self.data.get(sym)
        if e is None: return None, []
        f, hit = 1.0, []
        for ex, typ, fac, why in e["a"]:
            if d0 < dt.date.fromisoformat(ex) <= d1: f *= fac; hit.append(f"{ex} {why}")
        return f, hit
