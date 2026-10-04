"""證交所（上市）盤後資料：抓取網址與解析。"""
import datetime as dt

import pandas as pd

from ..util import clean_code, roc_to_date, security_type, to_num
from .common import build_frame, find_table

BASE = "https://www.twse.com.tw/rwd/zh"
MARKET = "TWSE"


def requests_for(d: dt.date) -> dict:
    """某交易日要抓的端點：{任務名稱: (url, params)}"""
    ymd = d.strftime("%Y%m%d")
    return {
        "twse_quotes": (f"{BASE}/afterTrading/MI_INDEX", {"date": ymd, "type": "ALLBUT0999", "response": "json"}),
        "twse_insti": (f"{BASE}/fund/T86", {"date": ymd, "selectType": "ALLBUT0999", "response": "json"}),
        "twse_margin": (f"{BASE}/marginTrading/MI_MARGN", {"date": ymd, "selectType": "ALL", "response": "json"}),
        "twse_valuation": (f"{BASE}/afterTrading/BWIBBU_d", {"date": ymd, "selectType": "ALL", "response": "json"}),
        "twse_qfii": (f"{BASE}/fund/MI_QFIIS", {"date": ymd, "selectType": "ALLBUT0999", "response": "json"}),
    }


def exright_request(start: dt.date, end: dt.date):
    return (f"{BASE}/exRight/TWT49U",
            {"startDate": start.strftime("%Y%m%d"), "endDate": end.strftime("%Y%m%d"), "response": "json"})


def has_data(body) -> bool:
    return isinstance(body, dict) and body.get("stat") == "OK"


def parse_quotes(body, d: dt.date) -> dict:
    """MI_INDEX → {'prices': 個股日行情, 'index': 加權指數與報酬指數}；非交易日回傳空 dict。"""
    if not has_data(body):
        return {}
    t = find_table(body, "每日收盤行情")
    fields, rows = (t["fields"], t["data"]) if t else (body.get("fields9"), body.get("data9"))
    prices = build_frame(fields, rows, d, MARKET, {
        "open": ("開盤價",), "high": ("最高價",), "low": ("最低價",), "close": ("收盤價",),
        "volume": ("成交股數",), "value": ("成交金額",), "trades": ("成交筆數",),
    })
    idx = {"date": pd.Timestamp(d)}
    for keyword, row_name, col in (("價格指數(臺灣證券交易所)", "發行量加權股價指數", "taiex"),
                                   ("報酬指數(臺灣證券交易所)", "發行量加權股價報酬指數", "taiex_tr")):
        tb = find_table(body, keyword)
        for r in (tb or {}).get("data") or []:
            if str(r[0]).strip() == row_name:
                idx[col] = to_num(r[1])
    index = pd.DataFrame([idx]) if len(idx) > 1 else pd.DataFrame()
    return {"prices": prices, "index": index}


def parse_insti(body, d: dt.date) -> dict:
    """T86 三大法人買賣超（單位：股）。外資 = 外陸資（不含外資自營商）＋外資自營商。"""
    if not has_data(body):
        return {}
    df = build_frame(body.get("fields"), body.get("data"), d, MARKET, {
        "foreign_ex_dealer": ("外陸資買賣超股數(不含外資自營商)", "外資買賣超股數"),
        "foreign_dealer": ("外資自營商買賣超股數",),
        "trust": ("投信買賣超股數",),
        "dealer": ("自營商買賣超股數",),
        "total": ("三大法人買賣超股數",),
    })
    if df.empty:
        return {"insti": df}
    fd = df["foreign_dealer"].fillna(0) if "foreign_dealer" in df else 0
    df["foreign"] = df["foreign_ex_dealer"] + fd
    df = df.drop(columns=[c for c in ("foreign_ex_dealer", "foreign_dealer", "name") if c in df])
    return {"insti": df}


def parse_margin(body, d: dt.date) -> dict:
    """MI_MARGN 融資融券（單位：張）。欄位名稱重複，所以用位置對應。"""
    if not has_data(body):
        return {}
    t = find_table(body, "融資融券彙總")
    if t is None:
        return {"margin": pd.DataFrame()}
    df = build_frame(t["fields"], t["data"], d, MARKET, {}, positional={
        "margin_buy": 2, "margin_sell": 3, "margin_redeem": 4, "margin_prev": 5, "margin_balance": 6,
        "short_buy": 8, "short_sell": 9, "short_redeem": 10, "short_prev": 11, "short_balance": 12, "offset": 14,
    })
    return {"margin": df.drop(columns=["name"], errors="ignore")}


def parse_valuation(body, d: dt.date) -> dict:
    """BWIBBU_d 本益比、殖利率、股價淨值比。"""
    if not has_data(body):
        return {}
    df = build_frame(body.get("fields"), body.get("data"), d, MARKET, {
        "pe": ("本益比",), "dividend_yield": ("殖利率(%)",), "pb": ("股價淨值比",),
    })
    return {"valuation": df.drop(columns=["name"], errors="ignore")}


def parse_qfii(body, d: dt.date) -> dict:
    """MI_QFIIS 外資持股。"""
    if not has_data(body):
        return {}
    df = build_frame(body.get("fields"), body.get("data"), d, MARKET, {
        "shares_issued": ("發行股數",), "foreign_shares": ("全體外資及陸資持有股數",),
        "foreign_ratio": ("全體外資及陸資持股比率",),
    })
    return {"qfii": df.drop(columns=["name"], errors="ignore")}


def parse_exright(body) -> pd.DataFrame:
    """TWT49U 除權息結果：除權息日、前收盤、參考價（用來計算還原股價）。"""
    if not has_data(body):
        return pd.DataFrame()
    f = body.get("fields") or []
    pos = {name: i for i, name in enumerate(f)}
    recs = []
    for r in body.get("data") or []:
        code = clean_code(r[pos["股票代號"]])
        if security_type(code) is None:
            continue
        d = roc_to_date(r[pos["資料日期"]])
        recs.append({
            "date": pd.Timestamp(d), "code": code, "market": MARKET,
            "prev_close": to_num(r[pos["除權息前收盤價"]]),
            "ref_price": to_num(r[pos["除權息參考價"]]),
            "value": to_num(r[pos["權值+息值"]]),
            "kind": str(r[pos["權/息"]]).strip(),
        })
    return pd.DataFrame.from_records(recs)


PARSERS = {
    "twse_quotes": parse_quotes,
    "twse_insti": parse_insti,
    "twse_margin": parse_margin,
    "twse_valuation": parse_valuation,
    "twse_qfii": parse_qfii,
}
