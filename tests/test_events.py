import pandas as pd

from pipeline.sources import openapi

TWSE = [
    {"出表日期": "1151008", "發言日期": "1151007", "發言時間": "142431", "公司代號": "1540", "公司名稱": "喬福",
     "主旨 ": "本公司舉辦之法人說明會", "符合條款": "第12款", "事實發生日": "1151015",
     "說明": "符合條款第四條第XX款：12\r\n事實發生日：115/10/15\r\n1.召開法人說明會之日期：115/10/15\r\n2.召開法人說明會之時間：14 時 00 分 \r\n3.召開法人說明會之地點：台北"},
    {"出表日期": "1151008", "發言日期": "1151007", "發言時間": "658", "公司代號": "6589", "公司名稱": "台康生技",
     "主旨 ": "本公司向歐盟藥品管理局\r\n提交上市許可申請", "符合條款": "第10款", "事實發生日": "1151006", "說明": "1.事實發生日:115/10/06"},
    {"出表日期": "1151008", "發言日期": "1151007", "發言時間": "172521", "公司代號": "7769", "公司名稱": "鴻勁",
     "主旨 ": "公告本公司受邀參加美國海外路演", "符合條款": "第12款", "事實發生日": "1151013",
     "說明": "1.召開法人說明會之日期：115/10/13 ~ 115/10/20\r\n2.召開法人說明會之時間：09 時 00 分 "},
    {"發言日期": "1151007", "發言時間": "1", "公司代號": "00878", "公司名稱": "某ETF", "主旨 ": "x", "符合條款": "第12款"},
]
TPEX = [
    {"Date": "1151008", "發言日期": "1151007", "發言時間": "153443", "SecuritiesCompanyCode": "3105", "CompanyName": "穩懋",
     "主旨": "公告將舉辦第三季線上法人說明會", "符合條款": "第12款", "事實發生日": "1151023",
     "說明": "召開法人說明會之日期：115/10/23\r\n召開法人說明會之時間：14 時 00 分"},
]


def test_twse_events():
    df = openapi.parse_events(TWSE, "TWSE")
    assert set(df["code"]) == {"1540", "6589", "7769"}          # ETF 代號被排除
    r = df[df["code"] == "1540"].iloc[0]
    assert r["is_conf"] and r["conf_date"] == pd.Timestamp("2026-10-15") and r["conf_time"] == "14:00"
    assert r["spoke_date"] == pd.Timestamp("2026-10-07")
    o = df[df["code"] == "6589"].iloc[0]
    assert not o["is_conf"] and pd.isna(o["conf_date"]) and o["spoke_time"] == "000658"
    assert "\r" not in o["subject"] and o["clause"] == 10
    t = df[df["code"] == "7769"].iloc[0]
    assert t["conf_date"] == pd.Timestamp("2026-10-13")         # 多日行程取第一天


def test_tpex_events():
    df = openapi.parse_events(TPEX, "TPEX")
    r = df.iloc[0]
    assert r["code"] == "3105" and r["market"] == "TPEX" and r["conf_date"] == pd.Timestamp("2026-10-23")


def test_empty():
    assert openapi.parse_events([], "TWSE").empty


def test_build_events_file(tmp_path):
    from pipeline.market import build_events
    from pipeline.storage import LocalStorage
    from pipeline.store import DataStore
    s = DataStore(LocalStorage(str(tmp_path)))
    s.upsert_table("events", pd.concat([openapi.parse_events(TWSE, "TWSE"), openapi.parse_events(TPEX, "TPEX")], ignore_index=True))
    e = build_events(s, "2026-10-08")
    assert len(e["recent"]) == 4 and {c["code"] for c in e["conf"]} == {"1540", "7769", "3105"}
    assert e["conf"][0]["d"] == "2026-10-13"
    assert build_events(DataStore(LocalStorage(str(tmp_path / "x"))), "2026-10-08")["recent"] == []
