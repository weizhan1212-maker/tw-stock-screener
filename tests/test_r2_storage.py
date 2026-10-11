"""R2Storage（S3 相容）讀寫、列出、本機 ETag 快取；用 moto 模擬，不連網路。"""
import os

import pytest

moto = pytest.importorskip("moto")


def test_r2_roundtrip(tmp_path, monkeypatch):
    from moto import mock_aws
    import boto3
    from pipeline import storage
    with mock_aws():
        monkeypatch.setenv("PIPELINE_CACHE_DIR", str(tmp_path / "c"))
        real = boto3.client

        def fake(*a, **k):
            k.pop("endpoint_url", None)
            k["region_name"] = "us-east-1"
            return real(*a, **k)
        monkeypatch.setattr(boto3, "client", fake)
        st = storage.R2Storage("acct", "id", "secret", "market-data")
        st.s3.create_bucket(Bucket="market-data")
        st.ensure_bucket()
        assert st.get("master/x.parquet") is None
        st.put("master/x.parquet", b"abc")
        st.put("site/a.json.gz", b"12345", "application/gzip")
        assert st.get("site/a.json.gz") == b"12345"
        assert st.sizes("") == {"master/x.parquet": 3, "site/a.json.gz": 5}
        assert st.list("site") == ["site/a.json.gz"]
        assert st.exists("master/x.parquet") and not st.exists("nope")
        hits = storage.SupabaseStorage.stats.get("cache_hits", 0)
        assert st.get("master/x.parquet") == b"abc"          # 本機快取命中（ETag 相同）
        assert storage.SupabaseStorage.stats.get("cache_hits", 0) == hits + 1
        assert os.path.exists(tmp_path / "c" / "master" / "x.parquet.etag")


def test_r2_quota_stop(monkeypatch):
    from moto import mock_aws
    import boto3
    from pipeline import storage
    with mock_aws():
        real = boto3.client

        def fake(*a, **k):
            k.pop("endpoint_url", None)
            k["region_name"] = "us-east-1"
            return real(*a, **k)
        monkeypatch.setattr(boto3, "client", fake)
        st = storage.R2Storage("acct", "id", "secret", "market-data")
        st.s3.create_bucket(Bucket="market-data")
        st.put("a.txt", b"x")
        u = st.record_usage(measure_bytes=True)
        assert u["A"] >= 2 and u["bytes"] >= 1
        st.check_quota()                                   # 遠低於 80%：通過
        import json
        st.s3.put_object(Bucket="market-data", Key=st._usage_key(), Body=json.dumps({"A": 800_000, "B": 0, "bytes": 0}).encode())
        with pytest.raises(storage.R2QuotaError):
            st.check_quota()
