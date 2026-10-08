"""
一次性：把使用者資料從 Storage 的 JSON 檔搬到 Supabase 資料庫（members、alert_users、user_kv）。
mode="merge"：資料庫已有的會被檔案版本覆蓋（第一次搬）；mode="ignore"：資料庫已有的不動（上線後補搬）。
可以重複執行。也提供 check()：只確認三張表存在。
"""
import json
import logging
import os
from urllib.parse import urlparse

import requests

log = logging.getLogger(__name__)
KEYS = {"watchlist", "screens", "portfolio", "alerts", "alert_state", "telegram"}


def _rest():
    url, key = os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"]
    u = urlparse(url.strip() if "://" in url else "https://" + url.strip())
    s = requests.Session()
    s.headers.update({"apikey": key, "content-type": "application/json"})
    if not key.startswith("sb_secret_"):
        s.headers["Authorization"] = f"Bearer {key}"
    return s, f"{u.scheme}://{u.netloc}/rest/v1"


def check() -> dict:
    s, base = _rest()
    out = {}
    for t in ("members", "alert_users", "user_kv"):
        r = s.get(f"{base}/{t}?select=*&limit=1", timeout=30)
        out[t] = r.status_code
    return out


def migrate(storage, mode: str = "merge") -> dict:
    s, base = _rest()
    prefer = f"resolution={'merge' if mode == 'merge' else 'ignore'}-duplicates,return=minimal"

    def upsert(table, rows, conflict):
        if not rows:
            return 0
        r = s.post(f"{base}/{table}?on_conflict={conflict}", data=json.dumps(rows), headers={"Prefer": prefer}, timeout=60)
        if r.status_code not in (200, 201, 204):
            raise RuntimeError(f"{table} 寫入失敗：{r.status_code} {r.text[:300]}")
        return len(rows)

    def load(path):
        raw = storage.get(path)
        return json.loads(raw) if raw else None

    res = {}
    al = load("auth/allowlist.json") or {"users": {}}
    members = [{"email": e.lower(), "name": m.get("name"), "status": m.get("status", "pending"),
                "requested_at": m.get("requested_at"), "decided_at": m.get("decided_at")}
               for e, m in (al.get("users") or {}).items()]
    members = [{k: v for k, v in m.items() if v is not None} for m in members]
    # PostgREST 批次寫入要求每列欄位相同：補齊
    cols = {k for m in members for k in m}
    members = [{k: m.get(k) for k in cols} for m in members]
    res["members"] = upsert("members", members, "email")

    idx = load("alerts/users.json") or {"users": []}
    res["alert_users"] = upsert("alert_users", [{"user_hash": h} for h in idx.get("users", [])], "user_hash")

    kv = []
    for path in storage.list("users"):
        parts = path.split("/")
        if len(parts) != 3 or not parts[2].endswith(".json"):
            continue
        key = parts[2][:-5]
        if key not in KEYS:
            continue
        v = load(path)
        if v is not None:
            kv.append({"user_hash": parts[1], "key": key, "value": v})
    res["user_kv"] = upsert("user_kv", kv, "user_hash,key")
    log.info("搬移結果：%s", res)
    return res


def selftest() -> dict:
    """同時寫入測試：模擬「管理員核准 A」與「B 第一次登入」、兩個使用者同時登記警報，各 20 次並行，
    確認沒有任何一筆被蓋掉。測試資料用 _selftest 前綴，結束後刪除。"""
    from concurrent.futures import ThreadPoolExecutor
    s, base = _rest()

    def post(table, row, conflict, how):
        r = s.post(f"{base}/{table}?on_conflict={conflict}", data=json.dumps(row),
                   headers={"Prefer": f"resolution={how}-duplicates,return=minimal"}, timeout=30)
        r.raise_for_status()

    a, b = "_selftest_a@example.com", "_selftest_b@example.com"
    post("members", {"email": a, "status": "pending"}, "email", "ignore")
    jobs = []
    with ThreadPoolExecutor(max_workers=8) as ex:
        for i in range(20):
            jobs.append(ex.submit(post, "members", {"email": a, "status": "approved", "decided_at": "2026-10-08T00:00:00Z"}, "email", "merge"))
            jobs.append(ex.submit(post, "members", {"email": f"_selftest_new{i}@example.com", "status": "pending"}, "email", "ignore"))
            jobs.append(ex.submit(post, "members", {"email": a, "status": "pending"}, "email", "ignore"))   # A 再次登入不應打回待核准
            jobs.append(ex.submit(post, "alert_users", {"user_hash": "_selftest_hash_1"}, "user_hash", "ignore"))
            jobs.append(ex.submit(post, "alert_users", {"user_hash": "_selftest_hash_2"}, "user_hash", "ignore"))
        for j in jobs:
            j.result()
    st = s.get(f"{base}/members?select=status&email=eq.{a}", timeout=30).json()
    news = s.get(f"{base}/members?select=email&email=like._selftest_new*", timeout=30).json()
    hs = s.get(f"{base}/alert_users?select=user_hash&user_hash=like._selftest_hash*", timeout=30).json()
    res = {"A 狀態（應為 approved）": st[0]["status"] if st else None, "新登入筆數（應為 20）": len(news),
           "警報名單（應為 2）": len(hs)}
    s.delete(f"{base}/members?email=like._selftest*", timeout=30)
    s.delete(f"{base}/alert_users?user_hash=like._selftest*", timeout=30)
    res["通過"] = res["A 狀態（應為 approved）"] == "approved" and len(news) == 20 and len(hs) == 2
    _ = b
    return res
