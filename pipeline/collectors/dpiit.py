import os, json, time, requests

# dpiit.gov.in is a JS app over a WordPress API; the HTML has no links, so call the API it calls.
API = "https://www.dpiit.gov.in/cms/wp-json/"
H = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "application/json, */*",
    "Accept-Encoding": "gzip, deflate",
    "Referer": "https://www.dpiit.gov.in/",
}
KEYS = ("fdi", "factsheet", "foreign direct investment")


def get(path):
    r = requests.get(API + path, headers=H, timeout=60)
    r.raise_for_status()
    time.sleep(0.5)
    return r.json()


def fetch_publications():
    posts, page = [], 1
    while True:
        j = get(f"document/documents?document_category=publications&limit=100&page={page}&sort=acf&order=DESC&search=")
        posts += j["posts"]
        if page >= int(j["total_pages"]):
            break
        page += 1
    assert len(posts) == int(j["total_items"]), "page count mismatch"

    ids = sorted({i for p in posts for f in p["acf_data"].get("file") or [] for i in f.get("file") or []})
    files = {}
    for k in range(0, len(ids), 40):
        for a in get("post-page/post?id=" + ",".join(map(str, ids[k:k + 40])))["posts"]:
            pdf = (a.get("acf_data") or {}).get("pdf") or {}
            files[a["ID"]] = {"title": a["post_title"], "url": pdf.get("url"), "size": pdf.get("filesize"),
                              "language": (a.get("acf_data") or {}).get("language")}

    out = []
    for p in posts:
        a, section, fl = p["acf_data"], None, []
        for f in a.get("file") or []:
            if f["type"] == "Content":  # heading row that groups the PDFs below it
                section = f["title"]
            elif f["type"] == "PDF":
                fl += [{"section": section, **files[i]} for i in f["file"] if i in files]
            else:
                fl.append({"section": section, "title": f.get("title"), "url": f.get("external_link")})
        out.append({"title": p["post_title"], "date": a.get("date"), "post_url": f"https://www.dpiit.gov.in/documents/{p['post_slug']}",
                    "is_fdi": any(k in p["post_title"].lower() for k in KEYS), "files": fl})
    return out


if __name__ == "__main__":
    os.makedirs("data", exist_ok=True)
    rows = fetch_publications()
    assert rows and any(r["is_fdi"] for r in rows), "no FDI publications found"
    with open("data/dpiit_fdi_publications.json", "w", encoding="utf-8") as f:
        json.dump(rows, f, indent=1, ensure_ascii=False)
    print("saved", len(rows), "publications,", sum(r["is_fdi"] for r in rows), "FDI,", sum(len(r["files"]) for r in rows), "files")
