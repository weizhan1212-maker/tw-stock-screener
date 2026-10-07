import pandas as pd

from pipeline.backtest import PitStore, fin_available, forward_adjusted, rebalance_months
from pipeline.storage import LocalStorage
from pipeline.store import DataStore


def test_fin_available():
    q = pd.Series(pd.to_datetime(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"]))
    assert [d.strftime("%Y-%m-%d") for d in fin_available(q)] == ["2025-05-15", "2025-08-14", "2025-11-14", "2026-03-31"]


def test_pit_store_hides_future(tmp_path):
    s = DataStore(LocalStorage(str(tmp_path)))
    s.upsert_table("income", pd.DataFrame({"code": "1234", "date": pd.to_datetime(["2025-12-31", "2026-03-31"]),
                                           "type": "EPS", "value": [1.0, 2.0]}))
    s.upsert_table("revenue", pd.DataFrame({"code": "1234", "year": [2026, 2026], "month": [3, 4], "revenue": [1, 2]}))
    p = PitStore(s, pd.Timestamp("2026-05-09"))
    assert p.read_table("income")["date"].tolist() == [pd.Timestamp("2025-12-31")]   # Q1 要 5/15 才可用
    assert p.read_table("revenue")["month"].tolist() == [3]                            # 4 月營收 5/10 才可用
    p2 = PitStore(s, pd.Timestamp("2026-05-15"))
    assert len(p2.read_table("income")) == 2 and len(p2.read_table("revenue")) == 2


def test_rebalance_months():
    days = pd.bdate_range("2024-01-01", "2025-03-05")
    ms = rebalance_months(days)
    assert ms[0]["signal"] > days[249].strftime("%Y-%m-%d")
    last = ms[-1]
    assert last["month"] == "2025-02" and last["signal"] == "2025-02-28" and last["exec"] == "2025-03-03"


def test_forward_adjusted_reinvests_dividend():
    prices = pd.DataFrame({"date": pd.to_datetime(["2026-08-03", "2026-08-04", "2026-08-05"]), "code": "1234",
                           "open": [100.0, 100.0, 97.0], "close": [100.0, 100.0, 97.0]})
    ex = pd.DataFrame({"date": pd.to_datetime(["2026-08-05"]), "code": ["1234"], "prev_close": [100.0], "ref_price": [97.0]})
    a = forward_adjusted(prices, ex)
    assert abs(a["aclose"].iloc[-1] - 100.0) < 1e-9 and abs(a["aopen"].iloc[-1] - 100.0) < 1e-9   # 除息不算虧損


def test_run_backtest_data_end_to_end(fake, tmp_path, monkeypatch):
    import datetime as dt
    import gzip
    import json

    from pipeline import backtest, jobs
    monkeypatch.setattr(backtest, "WARMUP_DAYS", 0)
    s = DataStore(LocalStorage(str(tmp_path)))
    jobs.run_daily(s, fake, lookback_days=5, today=dt.date(2026, 10, 2))
    for name in ("prices", "index", "valuation", "insti"):          # 複製一天當作 9/30（訊號日）
        d = s.read_daily(name)
        if not d.empty:
            s.upsert_daily(name, d.assign(date=pd.Timestamp("2026-09-30")))
    res = backtest.run_backtest_data(s, budget_min=5)
    idx = json.loads(s.st.get("site/bt/index.json"))
    assert res["failed"] == [] and idx["months"], (res, idx)
    m = idx["months"][0]
    snap = json.loads(gzip.decompress(s.st.get(f"site/bt/snap/{m['month']}.json.gz")))
    assert snap["meta"]["signal"] == m["signal"] and len(snap["rows"]) > 10 and "close" in snap["columns"]
    px = json.loads(gzip.decompress(s.st.get("site/bt/px/2026.json.gz")))
    assert m["exec"] in px["open"] and len(px["close"]) == len(px["dates"]) and len(px["close"][0]) == len(px["codes"])
