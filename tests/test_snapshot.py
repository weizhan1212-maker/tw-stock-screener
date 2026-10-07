import datetime as dt
import gzip
import json

import numpy as np
import pandas as pd

from pipeline import jobs
from pipeline.snapshot import SNAPSHOT_PATH, _decumulate, adjust_factors, build_snapshot, write_snapshot
from pipeline.storage import LocalStorage
from pipeline.store import DataStore


def test_adjust_factors():
    prices = pd.DataFrame({"date": pd.to_datetime(["2026-08-03", "2026-08-04", "2026-08-05", "2026-08-06"]),
                           "code": "1234", "close": [100, 100, 97, 98]})
    ex = pd.DataFrame({"date": pd.to_datetime(["2026-08-05"]), "code": ["1234"], "prev_close": [100.0], "ref_price": [97.0]})
    f = adjust_factors(prices, ex)
    assert np.allclose(f.values, [0.97, 0.97, 1, 1])
    assert np.allclose((prices["close"] * f).values, [97, 97, 97, 98])   # 除息不造成假跌


def test_decumulate_cashflow():
    cf = pd.DataFrame({"code": "1", "date": pd.to_datetime(["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"]),
                       "cfo": [10.0, 25, 45, 70, 12]})
    out = _decumulate(cf, ["cfo"])
    assert list(out["cfo"]) == [10, 15, 20, 25, 12]


def test_build_snapshot_from_fixtures(fake, tmp_path):
    s = DataStore(LocalStorage(str(tmp_path)))
    jobs.run_daily(s, fake, lookback_days=3, today=dt.date(2026, 10, 2))
    s.put_state("finmind_backfill", {"_complete": True})
    jobs.run_fin_refresh(s, fake)            # 補 2330 的財報
    df, meta = build_snapshot(s)
    assert meta["asof"] == "2026-10-02" and len(df) > 50
    r = df[df["code"] == "2330"].iloc[0]
    assert r["close"] > 0 and r["market"] == "TWSE" and r["volume_lots"] > 0
    assert r["eps_ttm"] > 0 and 0 < r["gross_margin"] < 100 and r["roe"] > 0
    assert set(df["sec_type"].dropna()) <= {"stock", "etf"}
    size = write_snapshot(s, df, meta)
    data = json.loads(gzip.decompress(s.st.get(SNAPSHOT_PATH)))
    assert size > 0 and data["meta"]["count"] == len(df) and len(data["rows"][0]) == len(data["columns"])


def test_strategy_factors_synthetic(tmp_path):
    """兩年 8 季的假資料：F-Score、EPS 成長、神奇公式指標都算得出來且合理。"""
    from pipeline.factors import finish, strategy_factors
    s = DataStore(LocalStorage(str(tmp_path)))
    dates = pd.to_datetime(["2024-03-31", "2024-06-30", "2024-09-30", "2024-12-31",
                            "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"])
    inc, bal, cf = [], [], []
    for i, d in enumerate(dates):
        g = 1.0 if i < 4 else 1.2           # 第二年成長 20%
        for t, v in (("Revenue", 100 * g), ("GrossProfit", 40 * g * (1 if i < 4 else 1.05)), ("OperatingIncome", 20 * g),
                     ("IncomeAfterTaxes", 15 * g), ("EquityAttributableToOwnersOfParent", 15 * g), ("EPS", 1.5 * g)):
            inc.append({"code": "1234", "date": d, "type": t, "value": v})
        for t, v in (("TotalAssets", 1000), ("CurrentAssets", 400), ("CurrentLiabilities", 200 - i * 5),
                     ("PropertyPlantAndEquipment", 300), ("CashAndCashEquivalents", 100), ("OrdinaryShare", 100),
                     ("LongtermBorrowings", 100 - i * 5), ("EquityAttributableToOwnersOfParent", 500), ("Equity", 500)):
            bal.append({"code": "1234", "date": d, "type": t, "value": v})
        q = (i % 4) + 1
        cf.append({"code": "1234", "date": d, "type": "CashFlowsFromOperatingActivities", "value": 25 * g * q})
    s.upsert_table("income", pd.DataFrame(inc))
    s.upsert_table("balance", pd.DataFrame(bal))
    s.upsert_table("cashflow", pd.DataFrame(cf))
    f = strategy_factors(s)
    r = f.loc["1234"]
    assert r["f_score"] == 9                          # 各項都改善
    assert abs(r["ebit_ttm"] - 96) < 1e-6 and abs(r["cfo_ttm"] - 120) < 1e-6
    assert r["eps_up3y"] != r["eps_up3y"] or r["eps_up3y"] in (0, 1)
    base = f.assign(market_cap=10.0, industry="半導體業")   # 10 億市值
    out = finish(base)
    assert out.loc["1234", "earnings_yield"] > 0 and out.loc["1234", "roc"] > 0 and out.loc["1234", "pcf"] > 0
    assert out.loc["1234", "is_financial"] == 0
    from pipeline.snapshot import fundamentals
    fu = fundamentals(s, pd.Timestamp("2026-03-01"))
    assert abs(fu.loc["1234", "eps_q_yoy"] - 20) < 1e-6        # 1.8 vs 1.5 → +20%


def test_new_technical_columns_synthetic():
    """距年線、距 60 日高、20 日均成交值、ATR%：用等差上漲的假資料驗算。"""
    from pipeline.snapshot import technicals
    n = 300
    c = pd.Series([100 + i * 0.5 for i in range(n)])
    px = pd.DataFrame({"code": "9999", "date": pd.date_range("2025-01-01", periods=n, freq="B"),
                       "close": c, "aclose": c, "ahigh": c + 1, "alow": c - 1, "volume": 1000.0,
                       "value": 2e8})
    last = technicals(px).loc["9999"]
    assert abs(last["avg_value20"] - 2.0) < 1e-9                              # 2 億
    assert abs(last["dist_high60"]) < 1e-9                                    # 一路創高
    ma240 = c.iloc[-240:].mean()
    assert abs(last["dist_ma240"] - (c.iloc[-1] / ma240 - 1) * 100) < 1e-9
    assert abs(last["atr_pct"] - 2.0 / c.iloc[-1] * 100) < 1e-6               # 真實波幅 = max(2, 1.5, 0.5) = 2


def test_trading_columns_industry_rank_and_inst_amount(tmp_path):
    from pipeline.snapshot import trading_columns
    s = DataStore(LocalStorage(str(tmp_path)))
    base = pd.DataFrame({"ind": ["半導體業", "半導體業", "半導體業", None], "ret20": [10.0, 5.0, -5.0, 3.0],
                         "ret60": [0.0] * 4, "close": [100.0] * 4, "total_net5": [1000.0] * 4,
                         "total_net20": [0.0] * 4}, index=["a", "b", "c", "d"])
    out = trading_columns(s, pd.Timestamp("2026-10-02"), base)
    assert out["industry_rank"].round(0).tolist()[:3] == [100.0, 67.0, 33.0] and pd.isna(out.loc["d", "industry_rank"])
    assert abs(out.loc["a", "inst_amt5"] - 1000 * 1000 * 100 / 1e8) < 1e-9     # 10 億


def test_main_industry():
    from pipeline.util import main_industry
    assert main_industry("24", "電子工業、半導體業") == "半導體業"
    assert main_industry("", "電子工業、電子零組件業") == "電子零組件業"
    assert main_industry(None, "化學生技醫療、生技醫療業") == "生技醫療業"
    assert main_industry(None, "其他、綠能環保") == "其他"
    assert main_industry(None, "其他電子類、半導體業") == "其他電子業"
    assert main_industry(None, "創新版股票、創新板股票、汽車工業") == "汽車工業"
    assert main_industry(None, None) is None
