from pipeline.storage import SupabaseStorage


class R:
    def __init__(self, code, content=b"", etag=None):
        self.status_code, self.content, self.text = code, content, ""
        self.headers = {"etag": f'"{etag}"'} if etag else {}


def test_parquet_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("PIPELINE_CACHE_DIR", str(tmp_path))
    st = SupabaseStorage("https://x.supabase.co", "k")
    remote = {"master/prices/2026-10.parquet": (b"v1", "e1"), "master/_state/days.json": (b"{}", "s1")}
    calls = []

    def fake(method, url, **kw):
        path = url.split("/market-data/")[1]
        calls.append((method, path))
        if method == "POST":
            remote[path] = (kw["data"], "e" + str(len(calls)))
            return R(200)
        body, tag = remote.get(path, (None, None))
        if body is None:
            return R(404)
        return R(200, b"" if method == "HEAD" else body, tag)

    monkeypatch.setattr(st, "_req", fake)
    p = "master/prices/2026-10.parquet"
    assert st.get(p) == b"v1"                       # 第一次下載
    calls.clear()
    assert st.get(p) == b"v1"                       # 第二次：只 HEAD
    assert [c[0] for c in calls] == ["HEAD"]
    remote[p] = (b"v2", "e2")                        # 別人改過 → ETag 不同 → 重新下載
    assert st.get(p) == b"v2"
    st.put(p, b"v3")                                 # 自己寫入後快取同步
    calls.clear()
    assert st.get(p) == b"v3" and [c[0] for c in calls] == ["HEAD"]
    calls.clear()
    st.get("master/_state/days.json")               # 狀態檔不快取，直接下載
    assert [c[0] for c in calls] == ["GET"]
