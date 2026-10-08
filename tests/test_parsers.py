import datetime as dt

import pandas as pd
import pytest

from conftest import load
from pipeline import util
from pipeline.sources import finmind, openapi, tpex, twse

D26 = dt.date(2026, 10, 2)
D22 = dt.date(2022, 1, 3)


def test_util():
    assert util.to_num("1,234.5") == 1234.5
    assert util.to_num(" -0.04 ") == -0.04
    assert util.to_num("87.84%") == 87.84
    assert util.to_num("--") != util.to_num("--")  # NaN
    assert util.roc_to_date("111年01月12日") == dt.date(2022, 1, 12)
    assert util.roc_to_date("1151002") == D26
    assert util.roc_to_date("115/04/10") == dt.date(2026, 4, 10)
    assert util.security_type("2330") == "stock"
    assert util.security_type("0050") == "etf"
    assert util.security_type("00679B") == "etf"
    assert util.security_type("006208") == "etf"
    assert util.security_type("00981A") == "etf"
    for bad in ("2881A", "020000", "912000", "700001", "01001T", "0"):
        assert util.security_type(bad) is None, bad


@pytest.mark.parametrize("tag,d", [("2026", D26), ("2022", D22)])
def test_twse_quotes(tag, d):
    out = twse.parse_quotes(load(f"twse_mi_index_{tag}"), d)
    p = out["prices"]
    assert not p.empty and set(p["market"]) == {"TWSE"}
    assert (p["date"] == pd.Timestamp(d)).all()
    assert "2881A" not in set(p["code"])
    r = p[p["code"] == "2330"].iloc[0]
    assert r["close"] > 0 and r["high"] >= r["low"] and r["volume"] > 0
    idx = out["index"].iloc[0]
    assert idx["taiex"] > 10000 and idx["taiex_tr"] > idx["taiex"]


def test_twse_holiday():
    assert twse.parse_quotes(load("twse_mi_index_holiday"), dt.date(2026, 10, 3)) == {}


@pytest.mark.parametrize("tag,d", [("2026", D26), ("2022", D22)])
def test_twse_insti(tag, d):
    df = twse.parse_insti(load(f"twse_t86_{tag}"), d)["insti"]
    assert not df.empty
    diff = (df["foreign"] + df["trust"] + df["dealer"] - df["total"]).abs()
    assert (diff <= 1).all()
    if tag == "2022":
        r = df[df["code"] == "2330"].iloc[0]
        assert r["foreign"] == 32537157 and r["trust"] == 1162044 and r["total"] == 35832737


@pytest.mark.parametrize("tag,d", [("2026", D26), ("2022", D22)])
def test_twse_margin(tag, d):
    df = twse.parse_margin(load(f"twse_margin_{tag}"), d)["margin"]
    assert not df.empty
    ok = (df["margin_prev"] + df["margin_buy"] - df["margin_sell"] - df["margin_redeem"] - df["margin_balance"]).abs() < 1
    assert ok.mean() > 0.95


@pytest.mark.parametrize("tag,d", [("2026", D26), ("2022", D22)])
def test_twse_valuation_qfii(tag, d):
    v = twse.parse_valuation(load(f"twse_bwibbu_{tag}"), d)["valuation"]
    assert not v.empty and v["pb"].notna().mean() > 0.9
    q = twse.parse_qfii(load(f"twse_qfiis_{tag}"), d)["qfii"]
    assert not q.empty and q["foreign_ratio"].between(0, 100).all()


def test_twse_exright():
    df = twse.parse_exright(load("twse_twt49u_2026"))
    assert not df.empty
    assert (df["ref_price"] <= df["prev_close"] + 1e-9).mean() > 0.9


@pytest.mark.parametrize("tag,d", [("2026", D26), ("2022", D22)])
def test_tpex_quotes(tag, d):
    p = tpex.parse_quotes(load(f"tpex_quotes_{tag}"), d)["prices"]
    assert not p.empty and set(p["market"]) == {"TPEX"}
    assert p["code"].map(util.security_type).notna().all()   # 權證已濾掉
    assert p["ref_next"].notna().mean() > 0.9


def test_tpex_wrong_date_rejected():
    assert tpex.parse_quotes(load("tpex_quotes_2026"), D22) == {}


def test_tpex_holiday():
    assert tpex.parse_quotes(load("tpex_quotes_holiday"), dt.date(2026, 10, 3)) == {}


@pytest.mark.parametrize("tag,d", [("2026", D26), ("2022", D22)])
def test_tpex_insti_margin_pe(tag, d):
    i = tpex.parse_insti(load(f"tpex_insti_{tag}"), d)["insti"]
    assert not i.empty
    m = tpex.parse_margin(load(f"tpex_margin_{tag}"), d)["margin"]
    ok = (m["margin_prev"] + m["margin_buy"] - m["margin_sell"] - m["margin_redeem"] - m["margin_balance"]).abs() < 1
    assert ok.mean() > 0.95
    v = tpex.parse_valuation(load(f"tpex_pe_{tag}"), d)["valuation"]
    assert not v.empty


def test_tpex_derive_exright():
    prices = pd.DataFrame({
        "date": pd.to_datetime(["2026-08-03", "2026-08-04", "2026-08-05"] * 2),
        "code": ["1234"] * 3 + ["5678"] * 3, "market": "TPEX",
        "close": [100, 100, 99, 50, 51, 52], "ref_next": [100, 97, 99, 50, 51, 52],
    })
    ev = tpex.derive_exright(prices)
    assert len(ev) == 1
    r = ev.iloc[0]
    assert r["code"] == "1234" and r["date"] == pd.Timestamp("2026-08-05") and r["ref_price"] == 97


def test_openapi_revenue_matches_finmind():
    oa = openapi.parse_revenue(load("twse_oa_revenue"), "TWSE")
    fm = finmind.parse_revenue(finmind.check(load("finmind_TaiwanStockMonthRevenue")))
    a = oa[oa["code"] == "2330"].iloc[0]
    b = fm[(fm["year"] == a["year"]) & (fm["month"] == a["month"])]
    assert len(b) == 1
    assert abs(b.iloc[0]["revenue"] - a["revenue"]) / a["revenue"] < 0.001   # 千元 ×1000 後一致


def test_openapi_misc():
    assert len(openapi.parse_company(load("twse_oa_company"), "TWSE")) > 30
    assert len(openapi.parse_company(load("tpex_oa_company"), "TPEX")) > 30
    per = openapi.parse_income_periods(load("tpex_oa_income"))
    assert per["year"].min() >= 2025 and per["quarter"].between(1, 4).all()
    per = openapi.parse_income_periods(load("twse_oa_income"))
    assert per["year"].min() >= 2025
    q = openapi.parse_tpex_qfii(load("tpex_oa_qfii"))
    assert q["foreign_ratio"].between(0, 100).all()
    assert len(openapi.parse_holidays(load("twse_oa_holiday"))) > 5


def test_finmind_parsers():
    inc = finmind.parse_statement(finmind.check(load("finmind_TaiwanStockFinancialStatements")), "income")
    assert {"date", "code", "type", "value"} <= set(inc.columns) and "EPS" in set(inc["type"])
    bal = finmind.parse_statement(finmind.check(load("finmind_TaiwanStockBalanceSheet")), "balance")
    assert not bal["type"].str.endswith("_per").any()
    div = finmind.parse_dividend(finmind.check(load("finmind_TaiwanStockDividend")))
    assert (div["cash"] >= 0).all() and div["cash"].max() > 0
    info = finmind.parse_info(finmind.check(load("finmind_TaiwanStockInfo")))
    assert info["code"].is_unique
    dl = finmind.parse_delisting(finmind.check(load("finmind_TaiwanStockDelisting")))
    assert not dl.empty


def test_finmind_rate_limit():
    with pytest.raises(finmind.RateLimited):
        finmind.check({"status": 402, "msg": "Requests reach the upper limit."})


def test_tpex_insti_old_format():
    import datetime as dt
    from pipeline.sources import tpex
    body = {"stat": "ok", "date": "20161012", "tables": [
        {"title": None, "fields": None, "data": []},
        {"title": "三大法人買賣明細資訊", "fields": ["代號", "名稱"] + [f"f{i}" for i in range(14)],
         "data": [["1258", "其祥-KY", "0", "1,000", "-1,000", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "-1,000"],
                  ["6488", "環球晶", "5,000", "1,000", "4,000", "2,000", "0", "2,000", "-500", "0", "0", "0", "0", "500", "-500", "5,500"]]}]}
    df = tpex.parse_insti(body, dt.date(2016, 10, 12))["insti"]
    r = df[df["code"] == "6488"].iloc[0]
    assert (r["foreign"], r["trust"], r["dealer"], r["total"]) == (4000, 2000, -500, 5500)
