#!/usr/bin/env python3
"""Daily email: builds one short summary from the public tables and sends it to every account that switched it on
(Daily email, under the header once signed in; the choice is stored in the account's user metadata).

Safe by default:
  * With no secrets set it only BUILDS the email and writes it to digest_preview.html (nothing is sent).
  * It sends only when SUPABASE_SERVICE_KEY (to list opted-in accounts) and RESEND_API_KEY (to send) are both set.
  * Only accounts with user_metadata.digest == "daily" receive anything. Every email says why it was sent and how to stop.
Usage: python3 pipeline/digest/send_digest.py [--to someone@example.com]   (--to sends one test email, needs RESEND_API_KEY)
Env: SUPABASE_URL (default: the project), SUPABASE_KEY (public key, default below), SUPABASE_SERVICE_KEY, RESEND_API_KEY, DIGEST_FROM, SITE_URL
"""
import argparse, html, json, os, sys, urllib.parse, urllib.request
from datetime import datetime, timedelta, timezone

URL = os.environ.get("SUPABASE_URL", "https://urpphqybqmxlwhjghsmf.supabase.co")
PUB = os.environ.get("SUPABASE_KEY", "sb_publishable_zSo8W_FfT_fZEcfMWoumOw_Yv9mmVWB")
SITE = os.environ.get("SITE_URL", "https://india-capital-tracker.ironmanbro.workers.dev")
IST = timezone(timedelta(hours=5, minutes=30))

def get(path, key=PUB):
    req = urllib.request.Request(f"{URL}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r: return json.load(r)

def usd_inr():
    try:
        with urllib.request.urlopen("https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR", timeout=20) as r: return float(json.load(r)["rates"]["INR"])
    except Exception: return None

def fmt_usd(m):
    a = abs(m); s = f"USD {a/1000:.2f} billion" if a >= 1000 else f"USD {a:,.0f} million"
    return ("−" if m < 0 else "+") + s

def fmt_cr(c): return ("−" if c < 0 else "+") + (f"₹{abs(c)/1e5:.1f} lakh cr" if abs(c) >= 1e5 else f"₹{abs(c):,.0f} cr")

def build(follow_names=()):
    today = datetime.now(IST).date(); week = (today - timedelta(days=7)).isoformat()
    esc = html.escape
    parts, text = [], []
    # 1. latest FPI flow (NSDL)
    try:  # the same table the site's Flows tab reads: daily NSDL, Total across segments
        since = (today - timedelta(days=15)).isoformat()
        fl = get(f"fpi_flows?select=day,segment,route,net_cr,net_usd_m&route=eq.Total&segment=eq.Total&day=gte.{since}&order=day.desc&limit=3")
    except Exception: fl = []
    fx = usd_inr()
    if fl:
        d, cr = fl[0]["day"], float(fl[0]["net_cr"])
        usd = f" ({fmt_usd(float(fl[0]['net_usd_m']))})" if fl[0].get("net_usd_m") is not None else (f" ({fmt_usd(cr * 10 / fx)})" if fx else "")
        line = f"FPI net flow, {d}: {fmt_cr(cr)}{usd}"
        parts.append(f"<h2>FPI flow</h2><p><b>{esc(line)}</b><br><small>NSDL. US$ at ₹{fx:.2f}</small></p>" if fx else f"<h2>FPI flow</h2><p><b>{esc(line)}</b></p>"); text.append(line)
    # 2. biggest deals, last 7 days
    try:
        deals = get(f"stories?select=title,url,amount_usd_m,event_type,source_name&published_at=gte.{week}&amount_usd_m=not.is.null&order=amount_usd_m.desc&limit=5")
    except Exception: deals = []
    if deals:
        parts.append("<h2>Biggest deals this week</h2><ul>" + "".join(f'<li><a href="{esc(d["url"] or SITE)}">{esc(d["title"])}</a> <small>USD {float(d["amount_usd_m"]):,.0f} million · {esc(d.get("source_name") or "")}</small></li>' for d in deals) + "</ul>")
        text += [f"- {d['title']} (USD {float(d['amount_usd_m']):,.0f} million)" for d in deals]
    # 3. new rules
    try:
        regs = get(f"stories?select=title,url,regulator,issued_on&event_type=eq.regulation&issued_on=gte.{week}&order=issued_on.desc&limit=5")
    except Exception: regs = []
    if regs:
        parts.append("<h2>New rules this week</h2><ul>" + "".join(f'<li><a href="{esc(r["url"] or SITE)}">{esc(r["title"])}</a> <small>{esc(r.get("regulator") or "")} · {esc(str(r["issued_on"]))}</small></li>' for r in regs) + "</ul>")
        text += [f"- {r['title']}" for r in regs]
    # 3b. Cap Radar: companies closest to their foreign investment limit (NSDL red-flag list) and the breach count
    try:
        lim = get("fpi_limits?select=list,as_of,company,raw&limit=1000")
        rows = []
        for r in lim:
            try: rows.append((r["list"], r["company"], float(r["raw"]["aggregate investment (%)"]), float(r["raw"]["aggregate permissible limit (%)"]), r["as_of"]))
            except (KeyError, TypeError, ValueError): pass
        red = sorted([x for x in rows if x[0] == "red_flag"], key=lambda x: x[3] - x[2])[:3]
        if red:
            nb = sum(1 for x in rows if x[0] == "breach")
            items = "".join(f"<li>{esc(x[1].title())}: {x[2]:.2f}% held of a {x[3]:.0f}% cap ({x[3]-x[2]:.2f} points of room)</li>" for x in red)
            parts.append(f'<h2>Closest to the foreign limit</h2><ul>{items}</ul><p><small>NSDL red-flag list as of {esc(red[0][4])}; {nb} more companies are already over their limit. <a href="{SITE}/v2/limits">Cap Radar</a></small></p>')
            text += [f"- {x[1].title()}: {x[2]:.2f}% of {x[3]:.0f}% cap" for x in red]
    except Exception: pass
    # 4. followed firms (opt-in)
    if follow_names:
        try:
            q = ",".join(f"investor.ilike.*{urllib.parse.quote(n.replace(',', ' '))}*" for n in follow_names[:10])
            fw = get(f"stories?select=title,url,investor&published_at=gte.{week}&or=({q})&order=published_at.desc&limit=6")
        except Exception: fw = []
        if fw:
            parts.append("<h2>Firms you follow</h2><ul>" + "".join(f'<li><a href="{esc(f["url"] or SITE)}">{esc(f["title"])}</a></li>' for f in fw) + "</ul>")
            text += [f"- {f['title']}" for f in fw]
    return parts, text, today

def wrap(parts, today, to):
    foot = f'<hr><p style="color:#666;font-size:12px">You get this because you switched on the daily email on Indian Capital Tracker. Stop it any time: sign in, then <b>Daily email</b> under the header. A personal project; not investment advice. Check the original source before relying on any item. <a href="{SITE}">Open the site</a></p>'
    return f'<!doctype html><html><body style="font:15px/1.5 -apple-system,Segoe UI,Arial,sans-serif;max-width:620px;margin:auto;padding:16px;color:#111"><h1 style="font-size:20px">Indian Capital Tracker, {today:%d %b %Y}</h1>{"".join(parts)}{foot}</body></html>'

def send(key, sender, to, subject, body, text):
    data = json.dumps({"from": sender, "to": [to], "subject": subject, "html": body, "text": text}).encode()
    req = urllib.request.Request("https://api.resend.com/emails", data=data, headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r: return r.status

def opted_in(service_key):
    out, page = [], 1
    while True:
        req = urllib.request.Request(f"{URL}/auth/v1/admin/users?page={page}&per_page=200", headers={"apikey": service_key, "Authorization": f"Bearer {service_key}"})
        with urllib.request.urlopen(req, timeout=60) as r: users = json.load(r).get("users", [])
        for u in users:
            m = u.get("user_metadata") or {}
            if m.get("digest") == "daily" and u.get("email") and u.get("email_confirmed_at"):
                out.append((u["email"], m.get("digest_firms") or [] if m.get("digest_follow") else []))
        if len(users) < 200: return out
        page += 1

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--to"); a = ap.parse_args()
    rkey, skey = os.environ.get("RESEND_API_KEY"), os.environ.get("SUPABASE_SERVICE_KEY")
    sender = os.environ.get("DIGEST_FROM", "Indian Capital Tracker <onboarding@resend.dev>")
    parts, text, today = build()
    if not parts: sys.exit("nothing to send today (no data came back); no email built")
    body = wrap(parts, today, None)
    open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "digest_preview.html"), "w", encoding="utf-8").write(body)
    print("built the email; preview in pipeline/digest/digest_preview.html")
    if a.to:
        if not rkey: sys.exit("--to needs RESEND_API_KEY")
        print("test email:", send(rkey, sender, a.to, f"Indian Capital Tracker, {today:%d %b}", body, "\n".join(text))); return
    if not (rkey and skey): print("RESEND_API_KEY and SUPABASE_SERVICE_KEY are not both set: nothing sent (preview only)"); return
    ok = bad = 0
    for email, firms in opted_in(skey):
        try:
            p2, t2, _ = build(firms) if firms else (parts, text, today)
            send(rkey, sender, email, f"Indian Capital Tracker, {today:%d %b}", wrap(p2, today, email), "\n".join(t2)); ok += 1
        except Exception as e: bad += 1; print("failed for one address:", type(e).__name__)
    print(f"sent {ok}, failed {bad}")
    if bad and not ok: sys.exit(1)

if __name__ == "__main__": main()
