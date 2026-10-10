"""除息／填息狀態與近一年現金股利。"""
import pandas as pd

from pipeline.snapshot import dividend_status


class FakeStore:
    def __init__(self, div):
        self.div = div

    def read_table(self, name):
        return self.div if name == "dividend" else pd.DataFrame()


def _prices(code, closes, start="2026-08-03"):
    d = pd.bdate_range(start, periods=len(closes))
    return pd.DataFrame({"code": code, "date": d, "close": closes})


def test_fill_states():
    asof = pd.Timestamp("2026-08-14")
    div = pd.DataFrame([
        {"code": "A", "cash": 5.0, "stock": 0, "cash_ex_date": pd.Timestamp("2026-08-06")},   # 跌破參考價：貼息
        {"code": "B", "cash": 1.0, "stock": 0, "cash_ex_date": pd.Timestamp("2026-08-06")},   # 漲回除息前：已填息
        {"code": "C", "cash": 2.0, "stock": 0, "cash_ex_date": pd.Timestamp("2026-08-06")},   # 參考價之上、未填完：填息中
        {"code": "D", "cash": 9.0, "stock": 0, "cash_ex_date": pd.Timestamp("2025-01-06")},   # 超過一年：不算
    ])
    px = pd.concat([
        _prices("A", [41.6, 41.9, 42.45, 36.55, 35.0, 33.0, 30.0, 29.5, 28.9, 28.9]),
        _prices("B", [20.0, 20.0, 20.0, 19.2, 19.5, 20.1, 20.0, 20.0, 20.0, 20.0]),
        _prices("C", [50.0, 50.0, 50.0, 48.2, 48.5, 49.0, 49.0, 49.0, 49.0, 49.0]),
    ])
    out = dividend_status(FakeStore(div), asof, px)
    assert out.loc["A", "div_fill_state"] == 0
    assert abs(out.loc["A", "div_ref_price"] - 37.45) < 1e-9
    assert out.loc["B", "div_fill_state"] == 2 and out.loc["B", "div_fill_days"] == 3
    assert out.loc["C", "div_fill_state"] == 1 and abs(out.loc["C", "div_fill_pct"] - 50.0) < 1e-9
    assert "D" not in out.index
    assert out.loc["A", "cash_div_12m"] == 5.0
