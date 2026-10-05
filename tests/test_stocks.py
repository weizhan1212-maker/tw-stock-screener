import datetime as dt
import gzip
import json

import pandas as pd

from pipeline import jobs
from pipeline.snapshot import build_snapshot
from pipeline.sources import tdcc
from pipeline.storage import LocalStorage
from pipeline.store import DataStore
from pipeline.stocks import PREFIX, build_all


def _store(tmp_path, fake):
    s = DataStore(LocalStorage(str(tmp_path)))
    jobs.run_daily(s, fake, lookback_days=3, today=dt.date(2026, 10, 2))
    s.put_state("finmind_backfill", {"_complete": True})
    jobs.run_fin_refresh(s, fake)
    return s


def test_tdcc_parse():
    t = ("資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%\n"
         "20261002,2330,1,500,1,1.5\n20261002,2330,12,10,1,0.5\n20261002,2330,15,1500,1,80\n"
         "20261002,2330,17,900,1,100\n20261002,700001,17,1,1,100\n")
    df = tdcc.parse(t)
    assert len(df) == 1
    r = df.iloc[0]
    assert r["pct_1000"] == 80 and r["pct_400"] == 80.5 and r["holders"] == 900 and r["pct_retail"] == 1.5


def test_build_stock_files(fake, tmp_path):
    s = _store(tmp_path, fake)
    res = build_all(s, codes=["2330", "0050"], workers=2)
    assert res["count"] == 2 and res["n_failed"] == 0
    d = json.loads(gzip.decompress(s.st.get(f"{PREFIX}/2330.json.gz")))
    assert d["info"]["name"] == "台積電" and d["info"]["market"] == "TWSE"
    daily = d["daily"]
    assert len(daily["d"]) == len(daily["c"]) == len(daily["fi"]) and daily["c"][-1] > 0
    assert d["quarters"] and d["quarters"][-1]["eps"] is not None and 0 < d["quarters"][-1]["gm"] < 100
    assert d["revenue"] and d["dividends"]
    assert d["holders"][-1]["big"] == 80


def test_health_scores(fake, tmp_path):
    s = _store(tmp_path, fake)
    df, _ = build_snapshot(s)
    r = df[df["code"] == "2330"].iloc[0]
    assert 0 <= r["hs_profit"] <= 100 and r["big_pct"] == 80
    assert df[df["sec_type"] == "etf"]["health_score"].isna().all()
