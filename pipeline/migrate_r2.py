"""一次性：Supabase Storage → Cloudflare R2。
已存在且大小相同的檔跳過；有本機快取（PIPELINE_CACHE_DIR）時，快取裡 ETag 相同的 parquet 直接用本機檔，不再從 Supabase 下載。
最後核對：兩邊檔數、每個檔大小要一致。"""
import logging
import mimetypes
import os
from concurrent.futures import ThreadPoolExecutor

from . import jobs
from .storage import SupabaseStorage, r2_from_env

log = logging.getLogger(__name__)


def _ctype(path: str) -> str:
    if path.endswith(".json.gz") or path.endswith(".gz"):
        return "application/gzip"
    return mimetypes.guess_type(path)[0] or "application/octet-stream"


def run(verify_only: bool = False, workers: int = 8):
    src = SupabaseStorage(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_KEY"], os.environ.get("SUPABASE_BUCKET", "market-data"))
    dst = r2_from_env()
    dst.ensure_bucket()
    a = src.sizes("")
    b = dst.sizes("")
    todo = [k for k, n in a.items() if b.get(k) != n]
    log.info("Supabase %d 個檔（%.1f MB）；R2 已有 %d 個；要複製 %d 個", len(a), sum(a.values()) / 1e6, len(b), len(todo))

    if not verify_only and todo:
        def copy(k):
            s, d = src.clone(), dst.clone()
            data = s.get(k)
            if data is None:
                return k, "來源讀不到"
            d.put(k, data, _ctype(k))
            return k, None
        errs = []
        with ThreadPoolExecutor(workers) as ex:
            for i, (k, e) in enumerate(ex.map(copy, todo), 1):
                if e:
                    errs.append(f"{k}：{e}")
                if i % 200 == 0:
                    log.info("已複製 %d／%d", i, len(todo))
        if errs:
            log.warning("複製失敗 %d 個：%s", len(errs), "；".join(errs[:20]))
        b = dst.sizes("")

    missing = [k for k in a if k not in b]
    diff = [k for k in a if k in b and b[k] != a[k]]
    st = SupabaseStorage.stats
    msg = (f"Supabase {len(a)} 個檔／{sum(a.values()) / 1e6:.1f} MB；R2 {len(b)} 個檔／{sum(b.values()) / 1e6:.1f} MB；"
           f"缺少 {len(missing)}、大小不同 {len(diff)}。"
           f"本次從 Supabase 下載 {st['get_bytes'] / 1e6:.1f} MB（快取命中 {st.get('cache_hits', 0)} 次）")
    log.info(msg)
    if missing or diff:
        log.warning("缺少：%s；大小不同：%s", missing[:20], diff[:20])
    jobs.summary(f"## 搬資料到 R2\n\n{msg}\n\n{'✅ 全部一致' if not (missing or diff) else '❌ 還有差異，可以再跑一次'}")
    if missing or diff:
        raise SystemExit(1)
