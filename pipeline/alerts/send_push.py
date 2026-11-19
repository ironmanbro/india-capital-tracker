#!/usr/bin/env python3
"""Sends watchlist alerts (Web Push). Run after each data refresh, once the new data files are in site/v2.

For every opted-in browser it finds items on its followed list that it has not been told about, and sends ONE notification naming them.
  * A follow is compared once silently first ("baselined"), so following something never fires an alert for old news.
  * Matching mirrors mockups/v2/watch.js (investor, company, country, topic, NSDL cap events); tests/parity.js keeps the two in step.
  * With no VAPID_PRIVATE_KEY or no SUPABASE_SERVICE_KEY nothing is sent and nothing is changed (dry run).
Env: SUPABASE_URL, SUPABASE_SERVICE_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com), SITE_DIR (default site/v2)
Usage: python3 send_push.py [--dry-run]"""
import argparse, json, os, re, sys, urllib.parse, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "site_v2"))
from common import norm   # same cleaning as the site's resolver.js

URL = os.environ.get("SUPABASE_URL", "https://urpphqybqmxlwhjghsmf.supabase.co").rstrip("/")
SITE_DIR = os.environ.get("SITE_DIR", os.path.join(HERE, "..", "..", "site", "v2"))
PUSH_HOSTS = re.compile(r"^https://(fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|web\.push\.apple\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.notify\.windows\.com|[a-z0-9-]+(\.[a-z0-9-]+)*\.push\.apple\.com)/")
LT = {"in": "entered the NSDL red-flag list", "up": "moved to the breach list", "down": "moved from breach back to red-flag", "out": "left the NSDL limit lists"}
MAXSENT = 1500

def js(v):
    """How JavaScript writes a value inside a string, so ids equal the ones watch.js makes."""
    return "null" if v is None else ("undefined" if v is ... else str(v))

def load(name, var):
    txt = open(os.path.join(SITE_DIR, name), encoding="utf-8").read()
    return json.loads(re.sub(r"^window\." + var + r"=|;\s*$", "", txt))

def hits_for(f, deals, regs, lim):
    k, key, label, out = f["k"], f["key"], f["label"], []
    def deal(r): out.append({"id": f"d|{js(r.get('d'))}|{js(r.get('t'))}", "d": r.get("d") or "", "text": f"{r.get('inv') or '–'}" + (f" → {r['tgt']}" if r.get("tgt") else "")})
    if k == "investor":
        for r in deals:
            if r.get("inv") and norm(r["inv"]) == key: deal(r)
    elif k == "company":
        if re.fullmatch(r"IN[EF][0-9A-Z]{9}", key):
            for e in (lim or {}).get("ev", []):
                if e["i"] == key: out.append({"id": f"l|{e['d']}|{e['i']}|{e['t']}", "d": e["d"], "text": f"{label} {LT.get(e['t'], 'changed list')} ({e['agg']:.2f}% held)"})
        n = norm(label)
        if len(n) >= 4:
            for r in deals:
                if r.get("tgt") and f" {n} " in f" {norm(r['tgt'])} ": deal(r)
    elif k == "country":
        for r in deals:
            if r.get("ic") and r["ic"].lower() == key: deal(r)
    elif k == "topic":
        for r in deals:
            if key in f"{r.get('t') or ''} {r.get('tgt') or ''} {r.get('inv') or ''}".lower(): deal(r)
        for r in regs:
            if key in f"{r.get('t') or ''} {r.get('s') or ''}".lower(): out.append({"id": f"r|{js(r.get('d'))}|{js(r.get('t'))}", "d": r.get("d") or "", "text": r.get("t") or ""})
    return out

def rest(method, path, key, body=None):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", method=method, data=None if body is None else json.dumps(body).encode(),
                                 headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=minimal"})
    with urllib.request.urlopen(req, timeout=60) as r: raw = r.read()
    return json.loads(raw) if raw and method == "GET" else None

def message(new):
    """new: [(label, [hits])] -> one notification."""
    n = sum(len(h) for _, h in new)
    lines = [f"{label}: {hs[0]['text']}" + (f" (+{len(hs) - 1} more)" if len(hs) > 1 else "") for label, hs in new[:3]]
    if len(new) > 3: lines.append(f"and {len(new) - 3} more on your list")
    return {"title": f"{n} new on your watchlist", "body": "\n".join(lines)[:240], "tag": "ict-watch", "url": "watchlist.html"}

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--dry-run", action="store_true"); a = ap.parse_args()
    skey, vkey, subj = os.environ.get("SUPABASE_SERVICE_KEY"), os.environ.get("VAPID_PRIVATE_KEY"), os.environ.get("VAPID_SUBJECT")
    live = bool(skey and vkey and subj) and not a.dry_run
    if not live: print("dry run: needs SUPABASE_SERVICE_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT; nothing will be sent or changed")
    if not skey: return
    deals, regs, lim = load("deals.js", "DEALS")["rows"], load("regs.js", "REGS")["regs"], load("limits.js", "LIM")
    if live:
        from pywebpush import webpush, WebPushException
    subs = rest("GET", "push_subscriptions?select=endpoint,p256dh,auth,follows,baselined,sent&limit=20000", skey)
    sent_n = gone = failed = quiet = 0
    for s in subs:
        if not PUSH_HOSTS.match(s["endpoint"]): continue                 # never post to anything but a real browser push service
        base, sent = set(s["baselined"] or []), list(s["sent"] or []); seen = set(sent); new = []; changed = False
        for f in s["follows"] or []:
            fid = f"{f['k']}|{f['key']}"; hs = hits_for(f, deals, regs, lim)
            if fid not in base:
                base.add(fid); changed = True
                for h in hs:
                    if h["id"] not in seen: sent.append(h["id"]); seen.add(h["id"])
                continue
            fresh = sorted([h for h in hs if h["id"] not in seen], key=lambda h: h["d"], reverse=True)
            if fresh: new.append((f["label"], fresh))
        patch = {"baselined": sorted(base), "sent": sent[-MAXSENT:]}
        if not new:
            quiet += 1
            if changed and live: rest("PATCH", "push_subscriptions?endpoint=eq." + urllib.parse.quote(s["endpoint"], safe=""), skey, patch)
            continue
        msg = message(new)
        if not live: print("would send to one browser:", msg["title"], "|", msg["body"].replace("\n", " / ")); continue
        try:
            webpush({"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}, data=json.dumps(msg), vapid_private_key=vkey, vapid_claims={"sub": subj}, ttl=86400)
            for _, hs in new:
                for h in hs: sent.append(h["id"])
            patch["sent"] = sent[-MAXSENT:]; rest("PATCH", "push_subscriptions?endpoint=eq." + urllib.parse.quote(s["endpoint"], safe=""), skey, patch); sent_n += 1
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code in (404, 410): rest("DELETE", "push_subscriptions?endpoint=eq." + urllib.parse.quote(s["endpoint"], safe=""), skey); gone += 1
            else: failed += 1; print("push failed:", code)
    print(f"subscriptions {len(subs)} · sent {sent_n} · nothing new {quiet} · expired and removed {gone} · failed {failed}")
    if failed and not sent_n: sys.exit(1)

if __name__ == "__main__": main()
