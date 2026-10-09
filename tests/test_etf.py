"""ETF 資料源：淨值表、公會月前十大解析、基金名稱對應代號（用真實樣本）。"""
import gzip
import json
import os
from collections import Counter

from pipeline.sources import etf, openapi

F = os.path.join(os.path.dirname(__file__), "fixtures")


def _load(name):
    with gzip.open(os.path.join(F, name)) as f:
        return f.read()


def test_nav():
    nav = etf.parse_nav(json.loads(_load("etf_nav.json.gz")))
    assert len(nav) > 300
    r = nav[nav.code == "0050"].iloc[-1]
    assert r["price"] > 0 and r["nav"] > 0 and r["premium"] is not None and r["name"] == "元大台灣50"


def test_top10_and_mapping():
    nav = etf.parse_nav(json.loads(_load("etf_nav.json.gz")))
    names = nav.groupby("code")["name"].last().to_dict()
    info = openapi.parse_etf_info(json.loads(_load("etf_twse_info.json.gz")))
    mapping = {}
    for cls in etf.SITCA_CLASSES:
        df = etf.parse_top10(_load(f"etf_sitca_{cls}_202608.html.gz").decode(), "202608", cls)
        assert len(df) > 100 and set(df.groupby("fund").size()) == {10}
        mapping.update(etf.map_funds(df["fund"].unique(), info, names))
    assert max(Counter(mapping.values()).values()) == 1             # 不會兩檔基金對到同一個代號
    by_code = {c: f for f, c in mapping.items()}
    assert "卓越50" in by_code["0050"] and "摩根" in by_code["0057"] and "上櫃ESG" in by_code["00928"]
