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

    # ---- 本機快取（GitHub Actions 用 actions/cache 保留）：只下載有變動的 parquet ----
    # Supabase 免費方案每月傳輸 5 GB；每天重複下載整份歷史資料會超量。
    # 有 PIPELINE_CACHE_DIR 時：parquet 先用 HEAD 比對 ETag（不傳內容），一樣就讀本機。狀態檔等小檔一律直接下載。
    def _cache_path(self, path: str):
        root = os.environ.get("PIPELINE_CACHE_DIR")
        if not root or not path.endswith(".parquet"):
            return None
        return os.path.join(root, path)

    def _etag(self, path: str) -> str | None:
        r = self._req("HEAD", f"{self.base}/object/{self.bucket}/{path}")
        if r.status_code != 200:
            return None
        return (r.headers.get("etag") or "").strip('"') or None

    def get(self, path: str) -> bytes | None:
        cp = self._cache_path(path)
        if cp and os.path.exists(cp) and os.path.exists(cp + ".etag"):
            tag = self._etag(path)
            with open(cp + ".etag") as f:
                same = bool(tag) and f.read().strip() == tag
            if same:
                SupabaseStorage.stats["cache_hits"] = SupabaseStorage.stats.get("cache_hits", 0) + 1
                with open(cp, "rb") as g:
                    return g.read()
        r = self._req("GET", f"{self.base}/object/{self.bucket}/{path}")
        if r.status_code == 200:
            st, n = SupabaseStorage.stats, len(r.content)
            st["get_bytes"] += n
            st["get_count"] += 1
            key = "/".join(path.split("/")[:2])
            st["by_prefix"][key] = st["by_prefix"].get(key, 0) + n
            tag = (r.headers.get("etag") or "").strip('"')
            if cp and tag:
                self._save_cache(cp, r.content, tag)
            return r.content
        if r.status_code in (400, 404) and ("not_found" in r.text.lower() or "not found" in r.text.lower()
                                            or r.status_code == 404):
            return None
        raise RuntimeError(f"讀取 {path} 失敗：{r.status_code} {r.text[:200]}")

    @staticmethod
    def _save_cache(cp: str, data: bytes, tag: str):
        os.makedirs(os.path.dirname(cp), exist_ok=True)
        with open(cp + ".tmp", "wb") as f:
            f.write(data)
        os.replace(cp + ".tmp", cp)
        with open(cp + ".etag", "w") as f:
            f.write(tag)

    def put(self, path: str, data: bytes, content_type: str = "application/octet-stream"):
        r = self._req("POST", f"{self.base}/object/{self.bucket}/{path}", data=data,
                      headers={"x-upsert": "true", "content-type": content_type})
        if r.status_code not in (200, 201):
            raise RuntimeError(f"寫入 {path} 失敗：{r.status_code} {r.text[:200]}")
        cp = self._cache_path(path)
        if cp:
            tag = self._etag(path)            # 寫完取新 ETag，下次讀就不用再下載
            if tag:
                self._save_cache(cp, data, tag)

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


class R2Storage:
    """Cloudflare R2（S3 相容）：下載流量免費。介面與 SupabaseStorage 相同，也沿用同一份下載量統計與本機 ETag 快取。"""
    stats = SupabaseStorage.stats

    def __init__(self, account: str, key_id: str, secret: str, bucket: str = "market-data"):
        import boto3
        from botocore.config import Config
        self._args = (account, key_id, secret, bucket)
        self.bucket = bucket
        self.s3 = boto3.client(
            "s3", endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
            aws_access_key_id=key_id, aws_secret_access_key=secret, region_name="auto",
            config=Config(retries={"max_attempts": 5, "mode": "standard"}, connect_timeout=30, read_timeout=120))

    def clone(self):
        return R2Storage(*self._args)

    def ensure_bucket(self):
        self.s3.head_bucket(Bucket=self.bucket)          # bucket 由 Willy 在 Cloudflare 後台建立；這裡只確認存在

    _cache_path = SupabaseStorage._cache_path
    _save_cache = staticmethod(SupabaseStorage._save_cache)

    def _etag(self, path: str) -> str | None:
        from botocore.exceptions import ClientError
        try:
            return self.s3.head_object(Bucket=self.bucket, Key=path)["ETag"].strip('"')
        except ClientError:
            return None

    def get(self, path: str) -> bytes | None:
        from botocore.exceptions import ClientError
        cp = self._cache_path(path)
        if cp and os.path.exists(cp) and os.path.exists(cp + ".etag"):
            tag = self._etag(path)
            with open(cp + ".etag") as f:
                same = bool(tag) and f.read().strip() == tag
            if same:
                self.stats["cache_hits"] = self.stats.get("cache_hits", 0) + 1
                with open(cp, "rb") as g:
                    return g.read()
        try:
            r = self.s3.get_object(Bucket=self.bucket, Key=path)
        except ClientError as e:
            if e.response.get("Error", {}).get("Code") in ("NoSuchKey", "404", "NotFound"):
                return None
            raise
        data = r["Body"].read()
        st = self.stats
        st["get_bytes"] += len(data)
        st["get_count"] += 1
        key = "/".join(path.split("/")[:2])
        st["by_prefix"][key] = st["by_prefix"].get(key, 0) + len(data)
        tag = (r.get("ETag") or "").strip('"')
        if cp and tag:
            self._save_cache(cp, data, tag)
        return data

    def put(self, path: str, data: bytes, content_type: str = "application/octet-stream"):
        r = self.s3.put_object(Bucket=self.bucket, Key=path, Body=data, ContentType=content_type)
        self.stats["put_bytes"] += len(data)
        cp = self._cache_path(path)
        tag = (r.get("ETag") or "").strip('"')
        if cp and tag:
            self._save_cache(cp, data, tag)

    def exists(self, path: str) -> bool:
        return self._etag(path) is not None

    def sizes(self, prefix: str = "") -> dict:
        out = {}
        for page in self.s3.get_paginator("list_objects_v2").paginate(Bucket=self.bucket, Prefix=prefix.rstrip("/")):
            for o in page.get("Contents", []) or []:
                out[o["Key"]] = int(o["Size"])
        return out

    def list(self, prefix: str) -> list[str]:
        p = prefix.rstrip("/")
        return sorted(k for k in self.sizes(p) if k == p or k.startswith(p + "/") or not p)


def r2_from_env() -> "R2Storage":
    acct = os.environ.get("R2_ACCOUNT_ID", "").strip()
    kid = os.environ.get("R2_ACCESS_KEY_ID", "").strip()
    sec = os.environ.get("R2_SECRET_ACCESS_KEY", "").strip()
    if not (acct and kid and sec):
        raise RuntimeError("缺少 R2_ACCOUNT_ID／R2_ACCESS_KEY_ID／R2_SECRET_ACCESS_KEY")
    return R2Storage(acct, kid, sec, os.environ.get("R2_BUCKET", "market-data"))


def from_env():
    """STORAGE=r2 且有 R2_* 金鑰就用 Cloudflare R2；否則有 SUPABASE_URL / SUPABASE_SERVICE_KEY 就用 Supabase；都沒有用本機 data/ 資料夾。
    （R2 要等資料搬完、核對過才把 STORAGE 設成 r2，避免讀到空的 R2）"""
    if os.environ.get("STORAGE", "").strip().lower() == "r2":
        st = r2_from_env()
        st.ensure_bucket()
        return st
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_SERVICE_KEY", "").strip()
    if url and key:
        st = SupabaseStorage(url, key, os.environ.get("SUPABASE_BUCKET", "market-data"))
        st.ensure_bucket()
        return st
    root = os.environ.get("LOCAL_DATA_DIR", "data")
    log.warning("未設定 Supabase，改用本機資料夾 %s", root)
    return LocalStorage(root)
