import datetime as dt

import pandas as pd

from conftest import load
from pipeline import jobs
from pipeline.market import build_market, write_market, MARKET_PATH
from pipeline.snapshot import build_snapshot
from pipeline.sources import extras, twse
from pipeline.storage import LocalStorage
from pipeline.store import DataStore

D = dt.date(2026, 10, 2)


def test_extras_parsers():
    ia = extras.parse_insti_amount(load("more_twse_bfi82u"), D).iloc[0]
    assert abs(ia["foreign"] + ia["trust"] + ia["dealer"] - ia["total"]) < 10
    dtd = extras.parse_daytrade(load("more_twse_twtb4u"), D)
    assert dtd["daytrade_total"].iloc[0]["volume_ratio"] > 0 and not dtd["daytrade"].empty
    sbl = extras.parse_sbl(load("more_twse_twt93u"), D)
    assert not sbl.empty and (sbl["sbl_balance"] >= 0).all()
    blk = extras.parse_block(load("more_twse_block"), D)
    assert blk.empty or (blk["block_value"] > 0).all()
    tia = extras.parse_tpex_insti_amount(load("more_tpex_insti_summary")).iloc[0]
    assert tia["market"] == "TPEX" and tia["total"] == 4701726734
    assert not extras.parse_tpex_daytrade(load("more_tpex_daytrade")).empty
    assert not extras.parse_tpex_sbl(load("more_tpex_sbl")).empty
    ti = extras.parse_tpex_index(load("more_tpex_index_hist"))
    assert ti["name"].eq("櫃買指數").all() and len(ti) == 3 and ti["chg_pct"].notna().all()
    ind = twse.parse_indices(load("more_twse_mi_index_ind"), D)
    assert "發行量加權股價指數" in set(ind["name"])


def test_futures_parser():
    rows = [
        {"Date": "20261002", "Contract": "TX", "ContractMonth(Week)": "202610", "Last": "48671", "Change": "-27", "%": "-0.06%",
         "Volume": "100", "OpenInterest": "5", "TradingSession": "一般"},
        {"Date": "20261002", "Contract": "TX", "ContractMonth(Week)": "202611", "Last": "48700", "Change": "-20", "%": "-0.04%",
         "Volume": "10", "OpenInterest": "1", "TradingSession": "一般"},
        {"Date": "20261002", "Contract": "TX", "ContractMonth(Week)": "202610", "Last": "49346", "Change": "675", "%": "1.39%",
         "Volume": "50", "OpenInterest": "", "TradingSession": "盤後"},
        {"Date": "20261002", "Contract": "TX", "ContractMonth(Week)": "202610/202611", "Last": "29", "Change": "",
         "%": "", "Volume": "1", "OpenInterest": "", "TradingSession": "一般"},
        {"Date": "20261002", "Contract": "MTX", "ContractMonth(Week)": "202610", "Last": "1", "Change": "", "%": "",
         "Volume": "1", "OpenInterest": "", "TradingSession": "一般"},
    ]
    f = extras.parse_futures(rows).set_index("session")
    assert len(f) == 2 and f.loc["一般", "close"] == 48671 and f.loc["盤後", "chg_pct"] == 1.39


def test_daily_with_extras_and_market(fake, tmp_path):
    s = DataStore(LocalStorage(str(tmp_path)))
    counts = jobs.run_daily(s, fake, lookback_days=3, today=D)
    assert counts["extras_twse_extra_days"] == 1
    assert not s.read_daily("market_insti").empty and not s.read_daily("daytrade").empty
    assert set(s.read_daily("market_insti")["market"]) == {"TWSE", "TPEX"}
    assert not s.read_daily("margin_total").empty and not s.read_daily("indices").empty
    m = build_market(s)
    assert m["asof"] == "2026-10-02"
    assert m["dca"]["stocks"][1] == {"code": "2884", "name": "玉山金", "accounts": 27261}
    assert m["dca"]["etfs"][0]["code"] == "0050"
    labels = [c["label"] for c in m["indices"]]
    assert "加權指數" in labels and "櫃買指數" in labels
    assert m["insti"]["total"] is not None and m["margin"]["margin_amount"] > 0
    assert m["breadth"]["all"]["up"] + m["breadth"]["all"]["down"] + m["breadth"]["all"]["flat"] >= 0
    assert write_market(s, m) > 0 and s.st.get(MARKET_PATH)
    df, _ = build_snapshot(s)
    assert {"daytrade_lots", "sbl_balance_lots", "total_value"} <= set(df.columns)


def test_margin_total_from_ms_only():
    """selectType=MS 的回應只有「信用交易統計」表，也要解析出融資總額。"""
    body = load("twse_margin_2026")
    body = {**body, "tables": [t for t in body["tables"] if "信用交易統計" in t.get("title", "")]}
    out = twse.parse_margin(body, D)
    assert out["margin"].empty
    assert out["margin_total"].iloc[0]["margin_amount"] > 1e11


def test_taiex_ohlc_and_indices_file(fake, tmp_path):
    import datetime as dt
    from conftest import load
    from pipeline import jobs
    from pipeline.market import build_indices
    from pipeline.sources import twse
    from pipeline.storage import LocalStorage
    from pipeline.store import DataStore
    oh = twse.parse_taiex_ohlc(load("twse_taiex_ohlc_202609"))
    assert len(oh) == 20 and (oh["high"] >= oh["low"]).all() and oh["close"].iloc[0] == 46948.72
    ind = twse.parse_indices(load("twse_mi_index_ind_2023"), dt.date(2023, 1, 3))
    assert "發行量加權股價指數" in set(ind["name"]) and len(ind) > 40
    s = DataStore(LocalStorage(str(tmp_path)))
    jobs.run_daily(s, fake, lookback_days=3, today=dt.date(2026, 10, 2))
    s.upsert_daily("indices", ind)
    s.upsert_daily("taiex_ohlc", oh)
    data = build_indices(s, asof="2026-10-02")
    assert data["series"]["發行量加權股價指數"]["o"][0] == 46177.11


def test_sentiment_parsers():
    from pipeline.sources import extras
    pcr = extras.parse_pcr([{"Date": "20261006", "PutVolume": "174220", "CallVolume": "161456", "PutCallVolumeRatio%": "107.91",
                             "PutOI": "87176", "CallOI": "91317", "PutCallOIRatio%": "95.47"}])
    assert pcr.iloc[0]["pcr_oi"] == 95.47 and str(pcr.iloc[0]["date"].date()) == "2026-10-06"
    fl = extras.parse_fut_large([
        {"Date": "20261006", "Contract": "TX", "SettlementMonth": "999912", "TypeOfTraders": "0", "Top5Buy": "75582", "Top5Sell": "57108",
         "Top10Buy": "83651", "Top10Sell": "79298", "OIOfMarket": "121509"},
        {"Date": "20261006", "Contract": "TX", "SettlementMonth": "999912", "TypeOfTraders": "1", "Top5Buy": "75582", "Top5Sell": "57108",
         "Top10Buy": "82375", "Top10Sell": "79298", "OIOfMarket": "121509"},
        {"Date": "20261006", "Contract": "TX", "SettlementMonth": "202610", "TypeOfTraders": "0", "Top5Buy": "1", "Top5Sell": "2",
         "Top10Buy": "1", "Top10Sell": "2", "OIOfMarket": "3"}])
    r = fl.iloc[0]
    assert len(fl) == 1 and r["top5_net"] == 18474 and r["top10_net"] == 4353 and r["top10_net_inst"] == 3077
    fi = extras.parse_fut_insti([{"Date": "20261006", "ContractCode": "臺股期貨", "Item": "外資及陸資", "OpenInterest(Net)": "-79517"},
                                 {"Date": "20261006", "ContractCode": "電子期貨", "Item": "外資及陸資", "OpenInterest(Net)": "5"}])
    assert fi.iloc[0]["foreign_oi_net"] == -79517
    fx = extras.parse_fx([{"Date": "20260901", "USD/NTD": "31.633"}])
    assert fx.iloc[0]["usd_twd"] == 31.633
