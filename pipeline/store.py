"""
資料集存取（Parquet）：
- 日資料（prices、insti、margin、valuation、qfii、index、exright）：依月份分檔
    master/{dataset}/{YYYY-MM}.parquet
- 其他表（財報、月營收、股利、股票清單…）：單一檔
    master/{table}.parquet
- 進度狀態：master/_state/{name}.json
寫入一律「讀出 → 合併 → 依鍵去重（新資料優先）→ 寫回」，重跑不會產生重複資料。
"""
import io
import json
import logging

import pandas as pd

log = logging.getLogger(__name__)

DAILY_KEYS = {
    "prices": ["date", "code"],
    "insti": ["date", "code"],
    "margin": ["date", "code"],
    "valuation": ["date", "code"],
    "qfii": ["date", "code"],
    "exright": ["date", "code"],
    "index": ["date"],
    "indices": ["date", "name"],          # 各類指數（證交所＋櫃買）
    "margin_total": ["date", "market"],   # 融資融券總額
    "market_insti": ["date", "market"],   # 三大法人買賣金額（元）
    "daytrade": ["date", "code"],         # 個股當沖量值
    "daytrade_total": ["date", "market"],
    "sbl": ["date", "code"],              # 借券賣出
    "block": ["date", "code"],            # 鉅額交易
    "futures": ["date", "session"],       # 台指期近月（一般／盤後）
}

TABLE_KEYS = {
    "income": ["code", "date", "type"],
    "balance": ["code", "date", "type"],
    "cashflow": ["code", "date", "type"],
    "revenue": ["code", "year", "month"],          # FinMind 歷史（回補寫入）
    "revenue_latest": ["code", "year", "month"],   # OpenAPI 最新一期（每日任務寫入，讀取時優先）
    "dividend": ["code", "date", "period"],
    "securities": ["code"],
    "company": ["code"],
    "delisting": ["code"],
    "income_periods": ["code", "year", "quarter"],
}


def to_parquet_bytes(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.to_parquet(buf, index=False, compression="zstd")
    return buf.getvalue()


def from_parquet_bytes(b: bytes) -> pd.DataFrame:
    return pd.read_parquet(io.BytesIO(b))


def _merge(old: pd.DataFrame | None, new: pd.DataFrame, keys: list[str]) -> pd.DataFrame:
    if old is None or old.empty:
        out = new
    else:
        out = pd.concat([old, new], ignore_index=True)
    out = out.drop_duplicates(keys, keep="last")
    return out.sort_values(keys).reset_index(drop=True)


class DataStore:
    def __init__(self, storage, prefix: str = "master"):
        self.st = storage
        self.prefix = prefix

    # ---- 日資料（月分檔） ----
    def _part(self, name, ym):
        return f"{self.prefix}/{name}/{ym}.parquet"

    def upsert_daily(self, name: str, df: pd.DataFrame) -> int:
        if df is None or df.empty:
            return 0
        keys = DAILY_KEYS[name]
        df = df.copy()
        df["date"] = pd.to_datetime(df["date"])
        n = 0
        for ym, part in df.groupby(df["date"].dt.strftime("%Y-%m")):
            path = self._part(name, ym)
            raw = self.st.get(path)
            old = from_parquet_bytes(raw) if raw else None
            merged = _merge(old, part, keys)
            self.st.put(path, to_parquet_bytes(merged))
            n += len(part)
        return n

    def months(self, name: str) -> list[str]:
        files = self.st.list(f"{self.prefix}/{name}")
        return sorted(f.rsplit("/", 1)[-1].removesuffix(".parquet") for f in files if f.endswith(".parquet"))

    def read_daily(self, name: str, start=None, end=None) -> pd.DataFrame:
        start = pd.Timestamp(start) if start is not None else None
        end = pd.Timestamp(end) if end is not None else None
        frames = []
        for ym in self.months(name):
            if start is not None and ym < start.strftime("%Y-%m"):
                continue
            if end is not None and ym > end.strftime("%Y-%m"):
                continue
            raw = self.st.get(self._part(name, ym))
            if raw:
                frames.append(from_parquet_bytes(raw))
        if not frames:
            return pd.DataFrame()
        df = pd.concat(frames, ignore_index=True)
        if start is not None:
            df = df[df["date"] >= start]
        if end is not None:
            df = df[df["date"] <= end]
        return df.reset_index(drop=True)

    # ---- 一般表（單一檔） ----
    def _table(self, name):
        return f"{self.prefix}/{name}.parquet"

    def read_table(self, name: str) -> pd.DataFrame:
        raw = self.st.get(self._table(name))
        return from_parquet_bytes(raw) if raw else pd.DataFrame()

    def upsert_table(self, name: str, df: pd.DataFrame, replace: bool = False) -> int:
        if df is None or df.empty:
            return 0
        old = None if replace else self.read_table(name)
        merged = _merge(old, df, TABLE_KEYS[name])
        self.st.put(self._table(name), to_parquet_bytes(merged))
        return len(df)

    # ---- 進度狀態 ----
    def get_state(self, name: str, default=None):
        raw = self.st.get(f"{self.prefix}/_state/{name}.json")
        return json.loads(raw) if raw else (default if default is not None else {})

    def put_state(self, name: str, obj):
        self.st.put(f"{self.prefix}/_state/{name}.json",
                    json.dumps(obj, ensure_ascii=False, default=str).encode("utf-8"), "application/json")
