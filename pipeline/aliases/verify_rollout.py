#!/usr/bin/env python3
"""Read-only checks of the alias rollout, from the outside (the public key, plain GET requests and one stable function call).
It never writes. Permissions are checked with the SQL in ROLLOUT.md, which you run yourself, not by attempting writes here.

  python3 verify_rollout.py --before                       # nothing applied yet: the alias objects must NOT exist
  python3 verify_rollout.py --after [--decisions alias-decisions-2026-11-14.json]

--after checks: the confirmed-alias view answers and is well-formed; no rejected name or rejected group is readable; every name
you confirmed (from the JSON export) is there under the same key the database computes; entity_of() resolves a sample.
Exit code 0 = every check passed. Environment: SUPABASE_URL, SUPABASE_KEY override the defaults (public project values)."""
import argparse, json, os, re, sys, urllib.error, urllib.request

URL = os.environ.get("SUPABASE_URL", "https://urpphqybqmxlwhjghsmf.supabase.co").rstrip("/")
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_zSo8W_FfT_fZEcfMWoumOw_Yv9mmVWB")
DROP = r"\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b"   # = SQL norm_name()
def norm(t):
    t = re.sub(r"[^a-zA-Z0-9]+", " ", t or "").lower()
    return re.sub(r"\s+", " ", re.sub(DROP, " ", t)).strip()

def call(path, method="GET", body=None):
    req = urllib.request.Request(URL + "/rest/v1/" + path, method=method, headers={"apikey": KEY, "Authorization": "Bearer " + KEY, "Content-Type": "application/json"},
                                 data=(json.dumps(body).encode() if body is not None else None))
    try:
        with urllib.request.urlopen(req, timeout=20) as r: return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read() or b"null")
        except Exception: return e.code, None

results = []
def check(name, ok, detail=""):
    results.append(ok); print(("PASS  " if ok else "FAIL  ") + name + (("  -  " + str(detail)) if detail else ""))
    return ok

def paged_view():
    rows = []
    for off in range(0, 100000, 1000):
        st, part = call(f"entity_alias_confirmed?select=kind,alias_key,relation,canonical,symbol,isin&order=kind,alias_key&limit=1000&offset={off}")
        if st != 200 or not isinstance(part, list): return st, None
        rows += part
        if len(part) < 1000: break
    return 200, rows

def before():
    st, _ = call("stories?select=id&limit=1"); check("API answers with the public key", st == 200, f"HTTP {st}")
    for obj in ("entity_alias_confirmed", "entity_group", "entity_alias"):
        st, body = call(f"{obj}?select=*&limit=1")
        check(f"{obj} does not exist yet", st == 404, f"HTTP {st}" + ("" if st == 404 else " (already applied?)"))

def after(decisions):
    st, _ = call("stories?select=id&limit=1"); check("API answers with the public key", st == 200, f"HTTP {st}")
    st, rows = paged_view()
    if not check("view entity_alias_confirmed answers", st == 200 and rows is not None, f"HTTP {st}"): return
    print(f"      {len(rows)} confirmed aliases ({sum(r['kind']=='investor' for r in rows)} investor, {sum(r['kind']=='company' for r in rows)} company)")
    keys = [(r["kind"], r["alias_key"]) for r in rows]
    check("no alias appears twice within a kind", len(keys) == len(set(keys)))
    check("every row has a kind, key, relation and group name", all(r["kind"] in ("investor", "company") and r["alias_key"] and r["relation"] in ("same", "fund_of", "vehicle_of", "related", "part_of") and r["canonical"] for r in rows))
    check("every ISIN has the right format and only company groups carry a symbol or ISIN", all((r["isin"] is None or re.match(r"^IN[A-Z0-9]{10}$", r["isin"])) and (r["kind"] == "company" or (r["symbol"] is None and r["isin"] is None)) for r in rows))
    st, rej = call("entity_alias?select=alias_key&status=eq.rejected&limit=5")
    check("rejected aliases are not readable by the public", (st == 200 and rej == []) or st in (401, 403), f"HTTP {st}, rows {len(rej) if isinstance(rej, list) else '-'}")
    st, groups = call("entity_group?select=canonical,kind&limit=5000")
    if check("groups are readable", st == 200 and isinstance(groups, list), f"HTTP {st}"):
        shown = {(g["kind"], g["canonical"]) for g in groups}; viewed = {(r["kind"], r["canonical"]) for r in rows}
        check("every readable group has a confirmed alias (no rejected group is published)", shown <= viewed, sorted(shown - viewed)[:3])
    if rows:
        samples = rows[:: max(1, len(rows) // 3)][:3]
        for r in samples:
            st, out = call("rpc/entity_of", "POST", {"p_name": r["alias_key"], "p_kind": r["kind"]})
            check(f"entity_of('{r['alias_key'][:30]}', {r['kind']}) returns '{r['canonical'][:30]}'", st == 200 and isinstance(out, list) and any(o.get("canonical") == r["canonical"] for o in out), f"HTTP {st}")
    if decisions:
        d = json.load(open(decisions)); inview = {(r["kind"], r["alias_key"]): r["canonical"] for r in rows}
        exp, rej_groups = {}, set()
        for g in d["decisions"]:
            if g["status"] == "confirmed":
                for m in g["members"]:
                    if m["status"] == "confirmed" and norm(m["alias"]): exp.setdefault((g["kind"], norm(m["alias"])), g["canonical"])
            else: rej_groups.add((g["kind"], g["canonical"]))
        missing = [k for k in exp if k not in inview]
        check(f"all {len(exp)} confirmed names from the export are live, under the key computed here", not missing, f"missing {len(missing)}: {missing[:3]}")
        wrong = [k for k, c in exp.items() if k in inview and inview[k] != c]
        check("each lands in the group you confirmed", not wrong, f"{len(wrong)} differ: {wrong[:3]}")
        extra = [k for k in inview if k not in exp]
        print(f"      note: {len(extra)} live aliases are not in this export (confirmed earlier, or by another export)")
        if st == 200 and isinstance(groups, list):
            check("no rejected group is readable", not (rej_groups & {(g['kind'], g['canonical']) for g in groups}), sorted(rej_groups & {(g['kind'], g['canonical']) for g in groups})[:3])

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--before", action="store_true"); ap.add_argument("--after", action="store_true"); ap.add_argument("--decisions")
    a = ap.parse_args()
    if a.before == a.after: ap.error("choose --before or --after")
    print("target:", URL); (before if a.before else lambda: after(a.decisions))()
    print("\n%d of %d checks passed" % (sum(results), len(results))); sys.exit(0 if all(results) else 1)
if __name__ == "__main__": main()
