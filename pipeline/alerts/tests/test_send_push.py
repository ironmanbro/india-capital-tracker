"""Logic test of send_push.py with a fake database and a fake push service (nothing real is contacted).
Run: python3 pipeline/alerts/tests/test_send_push.py"""
import json, os, shutil, sys, tempfile, types, io, contextlib
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, os.path.join(HERE, ".."))
calls = []
class WPE(Exception):
    def __init__(self, code): self.response = types.SimpleNamespace(status_code=code)
mode = {"fail": None}
def webpush(sub, data=None, **kw):
    if mode["fail"]: raise WPE(mode["fail"])
    calls.append(json.loads(data))
sys.modules["pywebpush"] = types.SimpleNamespace(webpush=webpush, WebPushException=WPE)
tmp = tempfile.mkdtemp(); os.environ.update(SITE_DIR=tmp, SUPABASE_SERVICE_KEY="k", VAPID_PRIVATE_KEY="v", VAPID_SUBJECT="mailto:a@example.com")
import send_push as sp
def write(deals):
    open(os.path.join(tmp, "deals.js"), "w").write("window.DEALS=" + json.dumps({"rows": deals}) + ";")
    open(os.path.join(tmp, "regs.js"), "w").write('window.REGS={"regs":[]};')
    open(os.path.join(tmp, "limits.js"), "w").write('window.LIM={"asof":"2026-11-19","rows":[],"ev":[]};')
D1 = {"d": "2026-11-18", "inv": "Blackstone Inc", "tgt": "IIFL Finance", "t": "Blackstone buys IIFL"}
D2 = {"d": "2026-11-19", "inv": "Blackstone", "tgt": "Other Co", "t": "Blackstone buys Other"}
EP = "https://fcm.googleapis.com/fcm/send/abc"
db = {"row": {"endpoint": EP, "p256dh": "p", "auth": "a", "follows": [{"k": "investor", "key": "blackstone", "label": "Blackstone"}], "baselined": [], "sent": []}, "deleted": False}
def rest(method, path, key, body=None):
    if method == "GET": return [db["row"]] if not db["deleted"] else []
    if method == "PATCH": db["row"].update(body)
    if method == "DELETE": db["deleted"] = True
sp.rest = rest
def run():
    sys.argv = ["x"]
    try:
        with contextlib.redirect_stdout(io.StringIO()): sp.main()
    except SystemExit as e: return e.code      # the job fails loudly when every send fails
ok = True
def check(name, cond):
    global ok; ok &= bool(cond); print(("PASS " if cond else "FAIL ") + name)
write([D1]); run()
check("first run is silent (baseline) and records the follow", not calls and db["row"]["baselined"] == ["investor|blackstone"] and len(db["row"]["sent"]) == 1)
write([D1, D2]); run()
check("a new matching deal sends exactly one notification", len(calls) == 1 and "Blackstone" in calls[0]["body"] and calls[0]["title"].startswith("1 new"))
check("and is remembered", len(db["row"]["sent"]) == 2)
run(); check("running again sends nothing more", len(calls) == 1)
db["row"]["follows"].append({"k": "topic", "key": "gift city", "label": "GIFT City"}); run()
check("a newly followed item is baselined, not announced", len(calls) == 1 and "topic|gift city" in db["row"]["baselined"])
D3 = {"d": "2026-11-20", "inv": "Citi", "tgt": "GIFT City fund", "t": "Citi launches GIFT City fund"}; D4 = {"d": "2026-11-20", "inv": "Blackstone", "tgt": "X", "t": "Blackstone buys X"}
write([D1, D2, D3, D4]); run()
check("two followed items changing give ONE combined notification", len(calls) == 2 and calls[1]["title"] == "2 new on your watchlist")
mode["fail"] = 500; write([D1, D2, D3, D4, {**D4, "t": "again"}]); n = len(db["row"]["sent"]); code = run()
check("a failed send is retried next run (not marked as sent) and the job exits non-zero", len(db["row"]["sent"]) == n and code == 1)
mode["fail"] = 410; run(); check("an expired subscription (410) is deleted", db["deleted"])
db["deleted"] = False; db["row"]["endpoint"] = "https://evil.example.com/x"; mode["fail"] = None; before = len(calls); run()
check("endpoints outside the real push services are never contacted", len(calls) == before)
shutil.rmtree(tmp); print("all passed" if ok else "FAILED"); sys.exit(0 if ok else 1)
