"""FinMind（免費版：一次查一檔，有 token 每小時 600 次）：財報、月營收、股利、股票清單、下市清單。"""
import os

import pandas as pd

from ..util import security_type

URL = "https://api.finmindtrade.com/api/v4/data"

# 我們用到的資料集 → 內部名稱
DATASETS = {
    "income": "TaiwanStockFinancialStatements",
    "balance": "TaiwanStockBalanceSheet",
    "cashflow": "TaiwanStockCashFlowsStatement",
    "revenue": "TaiwanStockMonthRevenue",
    "dividend": "TaiwanStockDividend",
}


class RateLimited(Exception):
    """超過每小時額度。"""


def token() -> str:
    return os.environ.get("FINMIND_TOKEN", "").strip()


def per_hour_limit() -> int:
    return 600 if token() else 300


def params(dataset: str, data_id: str | None = None, start: str | None = None) -> dict:
    p = {"dataset": dataset}
    if data_id:
        p["data_id"] = data_id
    if start:
        p["start_date"] = start
    if token():
        p["token"] = token()
    return p


def check(body) -> list:
    """回傳 data；額度用完丟 RateLimited，其他錯誤丟 ValueError。"""
    if not isinstance(body, dict):
        raise ValueError(f"FinMind 回應格式錯誤：{str(body)[:100]}")
    status = body.get("status")
    msg = str(body.get("msg", ""))
    if status == 402 or "upper limit" in msg.lower():
        raise RateLimited(msg)
    if status not in (200, None) and not body.get("data"):
        raise ValueError(f"FinMind 錯誤 {status}：{msg}")
    return body.get("data") or []


def parse_statement(data, kind: str) -> pd.DataFrame:
    """損益表／資產負債表／現金流量表 → 長表 date, code, type, value。資產負債表去掉百分比（_per）列。"""
    df = pd.DataFrame(data)
    if df.empty:
        return pd.DataFrame(columns=["date", "code", "type", "value"])
    df = df.rename(columns={"stock_id": "code"})[["date", "code", "type", "value"]]
    if kind == "balance":
        df = df[~df["type"].str.endswith("_per")]
    df["date"] = pd.to_datetime(df["date"])
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df.reset_index(drop=True)


def parse_revenue(data) -> pd.DataFrame:
    df = pd.DataFrame(data)
    if df.empty:
        return pd.DataFrame(columns=["code", "year", "month", "revenue", "source"])
    out = pd.DataFrame({
        "code": df["stock_id"].astype(str), "year": df["revenue_year"].astype(int),
        "month": df["revenue_month"].astype(int), "revenue": pd.to_numeric(df["revenue"], errors="coerce"),
        "source": "finmind",
    })
    return out


def parse_dividend(data) -> pd.DataFrame:
    df = pd.DataFrame(data)
    if df.empty:
        return pd.DataFrame(columns=["code", "date", "period", "cash", "stock", "cash_ex_date", "stock_ex_date"])
    num = lambda c: pd.to_numeric(df.get(c, 0), errors="coerce").fillna(0)  # noqa: E731
    out = pd.DataFrame({
        "code": df["stock_id"].astype(str),
        "date": pd.to_datetime(df["date"], errors="coerce"),
        "period": df.get("year", "").astype(str),
        "cash": num("CashEarningsDistribution") + num("CashStatutorySurplus"),
        "stock": num("StockEarningsDistribution") + num("StockStatutorySurplus"),
        "cash_ex_date": pd.to_datetime(df.get("CashExDividendTradingDate"), errors="coerce"),
        "stock_ex_date": pd.to_datetime(df.get("StockExDividendTradingDate"), errors="coerce"),
    })
    return out


def parse_info(data) -> pd.DataFrame:
    """股票清單：代號、名稱、產業、市場。同一檔可能有多個產業分類，合併成一列。"""
    df = pd.DataFrame(data)
    if df.empty:
        return df
    df["code"] = df["stock_id"].astype(str).str.strip()
    df["sec_type"] = df["code"].map(security_type)
    df = df[df["sec_type"].notna()]
    g = df.groupby("code").agg(
        name=("stock_name", "first"),
        industry=("industry_category", lambda s: "、".join(dict.fromkeys(x for x in s if x))),
        market=("type", "first"),
        sec_type=("sec_type", "first"),
    ).reset_index()
    g["market"] = g["market"].str.upper().replace({"TWSE": "TWSE", "TPEX": "TPEX"})
    return g


def parse_delisting(data) -> pd.DataFrame:
    df = pd.DataFrame(data)
    if df.empty:
        return pd.DataFrame(columns=["code", "name", "delisted_date"])
    out = pd.DataFrame({"code": df["stock_id"].astype(str).str.strip(), "name": df["stock_name"],
                        "delisted_date": pd.to_datetime(df["date"], errors="coerce")})
    return out[out["code"].map(security_type).notna()].reset_index(drop=True)
