"""
檔案儲存後端：
- LocalStorage：本機資料夾（測試、開發用）
- SupabaseStorage：Supabase Storage 私有 bucket（正式環境）
介面一致：get / put / exists / list
"""
import logging
import os
import time

import requests
from urllib.parse import urlparse

log = logging.getLogger(__name__)


class LocalStorage:
    def __init__(self, root: str):
        self.root = root

    def clone(self):
        return LocalStorage(self.root)

    def _p(self, path):
        return os.path.join(self.root, path)

    def get(self, path: str) -> bytes | None:
        try:
            with open(self._p(path), "rb") as f:
                return f.read()
        except FileNotFoundError:
            return None

    def put(self, path: str, data: bytes, content_type: str = "application/octet-stream"):
        p = self._p(path)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        tmp = p + ".tmp"
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, p)

    def exists(self, path: str) -> bool:
        return os.path.exists(self._p(path))

    def list(self, prefix: str) -> list[str]:
        base = self._p(prefix)
        out = []
        for dirpath, _, files in os.walk(base):
            for fn in files:
                if not fn.endswith(".tmp"):
                    out.append(os.path.relpath(os.path.join(dirpath, fn), self.root).replace(os.sep, "/"))
        return sorted(out)


class SupabaseStorage:
    # 下載量統計（所有 clone 共用）：Supabase 免費方案每月傳輸量有限，每個指令結束時印出來
    stats: dict = {"get_bytes": 0, "get_count": 0, "put_bytes": 0, "by_prefix": {}}

    def clone(self):
        """多執行緒上傳時，每個執行緒各用一份（requests.Session 不保證跨執行緒安全）。"""
        return SupabaseStorage(self._url, self._key, self.bucket)

    def __init__(self, url: str, key: str, bucket: str = "market-data"):
        self._url, self._key = url, key
        # 只取 https://xxxx.supabase.co，容許使用者貼成 .../rest/v1/ 等帶路徑的網址
        u = urlparse(url.strip() if "://" in url else "https://" + url.strip())
        self.base = f"{u.scheme}://{u.netloc}/storage/v1"
        self.bucket = bucket
        self.s = requests.Session()
        # 新版 secret key（sb_secret_ 開頭）只放 apikey 標頭；舊版 service_role JWT 兩個都放
        self.s.headers["apikey"] = key
        if not key.startswith("sb_secret_"):
            self.s.headers["Authorization"] = f"Bearer {key}"

    def _req(self, method, url, retries=3, **kw):
        for i in range(retries + 1):
            try:
                r = self.s.request(method, url, timeout=120, **kw)
                if r.status_code >= 500 and i < retries:
                    raise requests.HTTPError(f"HTTP {r.status_code}")
                return r
            except requests.RequestException as e:
                if i >= retries:
                    raise
                log.warning("Supabase %s %s 失敗：%s，重試", method, url, e)
                time.sleep(5 * (i + 1))

    def ensure_bucket(self):
        r = self._req("GET", f"{self.base}/bucket/{self.bucket}")
        if r.status_code == 200:
            return
        r = self._req("POST", f"{self.base}/bucket", json={"id": self.bucket, "name": self.bucket, "public": False})
        if r.status_code not in (200, 201) and "already exists" not in r.text.lower():
            raise RuntimeError(f"建立 bucket 失敗：{r.status_code} {r.text[:200]}")

    def get(self, path: str) -> bytes | None:
        r = self._req("GET", f"{self.base}/object/{self.bucket}/{path}")
        if r.status_code == 200:
            st, n = SupabaseStorage.stats, len(r.content)
            st["get_bytes"] += n
            st["get_count"] += 1
            key = "/".join(path.split("/")[:2])
            st["by_prefix"][key] = st["by_prefix"].get(key, 0) + n
            return r.content
        if r.status_code in (400, 404) and ("not_found" in r.text.lower() or "not found" in r.text.lower()
                                            or r.status_code == 404):
            return None
        raise RuntimeError(f"讀取 {path} 失敗：{r.status_code} {r.text[:200]}")

    def put(self, path: str, data: bytes, content_type: str = "application/octet-stream"):
        r = self._req("POST", f"{self.base}/object/{self.bucket}/{path}", data=data,
                      headers={"x-upsert": "true", "content-type": content_type})
        if r.status_code not in (200, 201):
            raise RuntimeError(f"寫入 {path} 失敗：{r.status_code} {r.text[:200]}")

    def exists(self, path: str) -> bool:
        return self.get(path) is not None

    def sizes(self, prefix: str = "") -> dict:
        """遞迴列出檔案大小（不下載內容）：{路徑: bytes}"""
        out, stack = {}, [prefix.rstrip("/")]
        while stack:
            folder = stack.pop()
            offset = 0
            while True:
                r = self._req("POST", f"{self.base}/object/list/{self.bucket}",
                              json={"prefix": folder, "limit": 1000, "offset": offset})
                r.raise_for_status()
                items = r.json()
                for it in items:
                    full = f"{folder}/{it['name']}" if folder else it["name"]
                    if it.get("id") is None:
                        stack.append(full)
                    else:
                        out[full] = int((it.get("metadata") or {}).get("size") or 0)
                if len(items) < 1000:
                    break
                offset += 1000
        return out

    def list(self, prefix: str) -> list[str]:
        """遞迴列出 prefix 底下所有檔案路徑。"""
        out, stack = [], [prefix.rstrip("/")]
        while stack:
            folder = stack.pop()
            offset = 0
            while True:
                r = self._req("POST", f"{self.base}/object/list/{self.bucket}",
                              json={"prefix": folder, "limit": 1000, "offset": offset})
                if r.status_code != 200:
                    raise RuntimeError(f"列出 {folder} 失敗：{r.status_code} {r.text[:200]}")
                items = r.json()
                for it in items:
                    full = f"{folder}/{it['name']}" if folder else it["name"]
                    if it.get("id") is None:      # 資料夾
                        stack.append(full)
                    else:
                        out.append(full)
                if len(items) < 1000:
                    break
                offset += 1000
        return sorted(out)


def from_env():
    """有 SUPABASE_URL / SUPABASE_SERVICE_KEY 就用 Supabase，否則用本機 data/ 資料夾。"""
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if url and key:
        st = SupabaseStorage(url, key, os.environ.get("SUPABASE_BUCKET", "market-data"))
        st.ensure_bucket()
        return st
    root = os.environ.get("LOCAL_DATA_DIR", "data")
    log.warning("未設定 Supabase，改用本機資料夾 %s", root)
    return LocalStorage(root)
