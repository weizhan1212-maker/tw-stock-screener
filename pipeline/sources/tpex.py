"""櫃買中心（上櫃）盤後資料：抓取網址與解析。只用新版網站端點（舊版會忽略日期參數）。"""
import datetime as dt
import logging

import pandas as pd

from ..util import to_num
from .common import build_frame, find_table

log = logging.getLogger(__name__)
BASE = "https://www.tpex.org.tw/www/zh-tw"
MARKET = "TPEX"


def requests_for(d: dt.date) -> dict:
    s = d.strftime("%Y/%m/%d")
    return {
        "tpex_quotes": (f"{BASE}/afterTrading/dailyQuotes", {"date": s, "response": "json"}),
        "tpex_insti": (f"{BASE}/insti/dailyTrade", {"type": "Daily", "sect": "EW", "date": s, "response": "json"}),
        "tpex_margin": (f"{BASE}/margin/balance", {"date": s, "response": "json"}),
        "tpex_valuation": (f"{BASE}/afterTrading/peQryDate", {"date": s, "response": "json"}),
    }


def _table(body, *keywords):
    """取第一個有資料的表（櫃買的表標題不一定穩定，關鍵字找不到就退回第一個表）。"""
    if not isinstance(body, dict) or str(body.get("stat", "")).lower() != "ok":
        return None
    t = find_table(body, *keywords) if keywords else None
    if t is None and body.get("tables"):
        t = body["tables"][0]
    if t is None or not t.get("data"):
        return None
    # 回應的日期必須等於要求的日期，避免拿到別天資料
    return t


def _date_ok(body, d: dt.date) -> bool:
    got = str(body.get("date", "")).strip()
    return got == d.strftime("%Y%m%d")


def parse_quotes(body, d: dt.date) -> dict:
    t = _table(body, "上櫃股票行情")
    if t is None:
        return {}
    if not _date_ok(body, d):
        log.warning("櫃買行情日期不符：要求 %s，回傳 %s", d, body.get("date"))
        return {}
    spec = {
        "open": ("開盤",), "high": ("最高",), "low": ("最低",), "close": ("收盤",),
        "volume": ("成交股數",), "value": ("成交金額",), "trades": ("成交筆數",),
        "shares_issued": ("發行股數",), "ref_next": ("次日參考價",),
    }
    # 一般行情表＋「管理股票」表（全額交割股等）都要
    frames = [build_frame(tb["fields"], tb["data"], d, MARKET, spec)
              for tb in body.get("tables") or [] if tb.get("data")]
    frames = [f for f in frames if not f.empty]
    df = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame()
    if not df.empty:
        df = df.drop_duplicates(["date", "code"], keep="first")
    return {"prices": df}


# 三大法人表的欄位名稱重複（每組都叫 買進股數／賣出股數／買賣超股數），依位置對應：
# [2-4] 外資及陸資(不含外資自營商) [5-7] 外資自營商 [8-10] 外資及陸資合計 [11-13] 投信
# [14-16] 自營商(自行買賣) [17-19] 自營商(避險) [20-22] 自營商合計 [23] 三大法人合計
INSTI_POS = {"foreign": 10, "trust": 13, "dealer": 22, "total": 23}


def parse_insti(body, d: dt.date) -> dict:
    t = _table(body, "三大法人")
    if t is None or not _date_ok(body, d):
        return {}
    if len(t["fields"]) != 24:
        raise ValueError(f"櫃買三大法人欄位數改變：{len(t['fields'])}，需要更新解析程式")
    df = build_frame(t["fields"], t["data"], d, MARKET, {}, positional=INSTI_POS)
    if not df.empty:
        # 檢查碼：外資＋投信＋自營商 = 三大法人合計
        bad = (df["foreign"] + df["trust"] + df["dealer"] - df["total"]).abs() > 1
        if bad.any():
            raise ValueError(f"櫃買三大法人加總不符 {int(bad.sum())} 筆，欄位位置可能改變")
    return {"insti": df.drop(columns=["name"], errors="ignore")}


def parse_margin(body, d: dt.date) -> dict:
    t = _table(body, "融資融券")
    if t is None or not _date_ok(body, d):
        return {}
    df = build_frame(t["fields"], t["data"], d, MARKET, {
        "margin_prev": ("前資餘額",), "margin_buy": ("資買",), "margin_sell": ("資賣",), "margin_redeem": ("現償",),
        "margin_balance": ("資餘額",), "short_prev": ("前券餘額",), "short_sell": ("券賣",), "short_buy": ("券買",),
        "short_redeem": ("券償",), "short_balance": ("券餘額",), "offset": ("資券相抵",),
    })
    return {"margin": df.drop(columns=["name"], errors="ignore")}


def parse_valuation(body, d: dt.date) -> dict:
    t = _table(body)
    if t is None or not _date_ok(body, d):
        return {}
    df = build_frame(t["fields"], t["data"], d, MARKET, {
        "pe": ("本益比",), "dividend_yield": ("殖利率(%)",), "pb": ("股價淨值比",),
    })
    return {"valuation": df.drop(columns=["name"], errors="ignore")}


def derive_exright(prices: pd.DataFrame) -> pd.DataFrame:
    """
    櫃買沒有除權息歷史端點，改用行情中的「次日參考價」推算：
    次日參考價 ≠ 當日收盤 → 隔一個交易日是除權息（或減資等）日。
    回傳欄位與證交所 TWT49U 一致：date(事件日)、code、prev_close、ref_price。
    """
    if prices.empty or "ref_next" not in prices:
        return pd.DataFrame()
    p = prices[prices["market"] == MARKET][["date", "code", "close", "ref_next"]].sort_values(["code", "date"])
    p["next_date"] = p.groupby("code")["date"].shift(-1)
    ev = p[(p["close"] > 0) & (p["ref_next"] > 0) & ((p["ref_next"] - p["close"]).abs() > 1e-6)
           & p["next_date"].notna()]
    return pd.DataFrame({
        "date": ev["next_date"].values, "code": ev["code"].values, "market": MARKET,
        "prev_close": ev["close"].values, "ref_price": ev["ref_next"].values,
        "value": (ev["close"] - ev["ref_next"]).values, "kind": "推算",
    })


PARSERS = {
    "tpex_quotes": parse_quotes,
    "tpex_insti": parse_insti,
    "tpex_margin": parse_margin,
    "tpex_valuation": parse_valuation,
}
