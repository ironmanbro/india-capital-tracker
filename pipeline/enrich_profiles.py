"""Add fund size, headcount and key people from Wikidata to investors that already have a Wikidata id (stdlib only).
Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Usage: python3 pipeline/enrich_profiles.py [--dry-run]"""
import json, os, sys, urllib.parse, urllib.request

WD = "https://www.wikidata.org/w/api.php"
UA = {"User-Agent": "IndianCapitalTracker/1.0 (kishansinghania18@gmail.com)"}
url, key = os.environ.get("SUPABASE_URL", "").rstrip("/"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
rest = lambda path, **kw: urllib.request.Request(f"{url}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", **kw.pop("headers", {})}, **kw)


def wd(ids, props):
    q = urllib.parse.urlencode({"action": "wbgetentities", "ids": "|".join(ids), "props": props, "languages": "en", "format": "json"})
    return json.load(urllib.request.urlopen(urllib.request.Request(f"{WD}?{q}", headers=UA), timeout=60)).get("entities", {})


def claim(e, p):
    return [c["mainsnak"]["datavalue"]["value"] for c in e.get("claims", {}).get(p, []) if c.get("mainsnak", {}).get("datavalue") and c.get("rank") != "deprecated"]


def main(argv):
    rows = json.load(urllib.request.urlopen(rest("investor_profiles?select=holder,wikidata_id&wikidata_id=not.is.null&limit=2000"), timeout=60))
    out, ids = [], [r["wikidata_id"] for r in rows]
    ents = {}
    for i in range(0, len(ids), 50):
        ents.update(wd(ids[i:i + 50], "claims"))
    refs = {v["id"] for e in ents.values() for p in ("P169", "P488", "P112", "P159") for v in claim(e, p) if isinstance(v, dict) and "id" in v}
    labels = {}
    for i in range(0, len(refs), 50):
        for q, e in wd(list(refs)[i:i + 50], "labels").items():
            labels[q] = e.get("labels", {}).get("en", {}).get("value")
    lab = lambda e, p: [labels[v["id"]] for v in claim(e, p) if isinstance(v, dict) and labels.get(v.get("id"))]
    for r in rows:
        e = ents.get(r["wikidata_id"])
        if not e:
            continue
        assets = next((float(v["amount"]) for v in claim(e, "P2403") if isinstance(v, dict) and v.get("unit", "").endswith("/Q4917")), None)  # Q4917 = US dollar
        emp = next((int(float(v["amount"])) for v in claim(e, "P1128") if isinstance(v, dict) and "amount" in v), None)
        ceo, chair, found, hq = lab(e, "P169"), lab(e, "P488"), lab(e, "P112"), lab(e, "P159")
        if any([assets, emp, ceo, chair, found]):
            out.append({"holder": r["holder"], "wikidata_id": r["wikidata_id"], "total_assets_usd": assets, "employees": emp, "ceo": ceo[0] if ceo else None,
                        "chair": chair[0] if chair else None, "founders": found[:6] or None, "headquarters": hq[0] if hq else None})
    print(f"{len(rows)} investors with a Wikidata id, {len(out)} with size or people data")
    if "--dry-run" in argv or not (url and key) or not out:
        return
    for i in range(0, len(out), 200):
        urllib.request.urlopen(rest("investor_enrichment?on_conflict=holder", data=json.dumps(out[i:i + 200]).encode(), method="POST",
                                    headers={"Prefer": "resolution=merge-duplicates,return=minimal"}), timeout=60).close()


if __name__ == "__main__":
    main(sys.argv[1:])
