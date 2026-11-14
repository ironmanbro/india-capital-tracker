"""Shared helpers for the builders that produce the data files of the /v2 pages.
Reads the project's public tables with the public (read-only) key; no secret is needed. Environment SUPABASE_URL and SUPABASE_KEY override."""
import datetime as dt, json, os, re, urllib.parse, urllib.request
from zoneinfo import ZoneInfo

URL = os.environ.get("SUPABASE_URL", "https://urpphqybqmxlwhjghsmf.supabase.co").rstrip("/") + "/rest/v1/"
KEY = os.environ.get("SUPABASE_KEY", "sb_publishable_zSo8W_FfT_fZEcfMWoumOw_Yv9mmVWB")
IST = ZoneInfo("Asia/Kolkata")

def today():
    """Today's date in India. Every 'last 90 days' style window is measured from this."""
    return dt.datetime.now(IST).date()

def built_stamp():
    return dt.datetime.now(dt.UTC).strftime("%Y-%m-%d %H:%M UTC")

def get(path, post=None, timeout=120):
    path = urllib.parse.quote(path, safe="/?&=.,()*:%-_~!")
    headers = {"apikey": KEY, "Authorization": "Bearer " + KEY}
    data = None
    if post is not None:
        headers["Content-Type"] = "application/json"; data = json.dumps(post).encode()
    req = urllib.request.Request(URL + path, headers=headers, data=data)
    last = None
    for attempt in range(3):                       # a transient network error should not fail the whole refresh
        try:
            return json.load(urllib.request.urlopen(req, timeout=timeout))
        except Exception as e:                      # noqa: BLE001
            last = e
    raise RuntimeError(f"request failed after 3 tries: {path[:120]} ({last})")

def paged(path, step=1000, cap=60000):
    """The API returns at most 1,000 rows a request, so page through."""
    out = []
    for off in range(0, cap, step):
        part = get(f"{path}&limit={step}&offset={off}")
        out += part
        if len(part) < step: break
    return out

# Same words as the SQL function norm_name() (supabase/migrations/20261029_investor_profiles.sql)
_DROP = r"\b(ltd|limited|inc|llc|llp|plc|pte|pcc|vcc|the|co|corp|corporation|sa|ag|nv|bv|fund|funds|trust|lp)\b"
def norm(t):
    t = re.sub(r"[^a-zA-Z0-9]+", " ", t or "").lower()
    return re.sub(r"\s+", " ", re.sub(_DROP, " ", t)).strip()

_STORIES = {}
def stories():
    """Every story that names an investor or a target, fetched once per run and shared by the builders."""
    if "all" not in _STORIES:
        _STORIES["all"] = paged("stories?select=published_at,source,source_name,title,investor,investor_type,investor_country,target,amount_usd_m,deal_stage,event_type,flow_kind,reports&order=published_at.desc")
    return _STORIES["all"]

def write_js(path, var, obj):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write("window." + var + "=" + json.dumps(obj, separators=(",", ":"), ensure_ascii=False) + ";")
    os.replace(tmp, path)

class BuildError(Exception):
    """Raised when fetched data looks wrong; the old files are then left untouched."""
