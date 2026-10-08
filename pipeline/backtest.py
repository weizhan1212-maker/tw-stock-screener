"""
回測資料：給網站在瀏覽器裡跑回測用（D15、D20）。

產出（都在 Supabase Storage 的 site/bt/ 底下）：
    site/bt/index.json             可回測的月份（訊號日、成交日）與價格年份
    site/bt/snap/{YYYY-MM}.json.gz 每月最後一個交易日收盤後的「當時」篩選快照（只含普通股）
    site/bt/px/{YYYY}.json.gz      該年每個交易日的還原收盤價、每月第一個交易日的還原開盤價、報酬指數

避免偷看未來（前視偏誤）：
- 季財報：過了法定公布期限才納入（Q1→5/15、Q2→8/14、Q3→11/14、年報→次年 3/31）
- 月營收：次月 10 日後才納入
- 股利：公告日之後才納入
- 已下市股票：當時有交易就會出現在快照與價格裡（避免倖存者偏差）
限制：發行股數、產業別用最新資料（影響市值與產業，偏差很小，頁面上註明）。

還原價用「向前還原」：第一天＝原始價，之後每次除權息把價格除以（參考價 ÷ 前收盤），
等於股利再投入；過去的數字不會因為未來的除權息而改變，舊年份檔案可以長期快取。
"""
import gzip
import json
import logging
import time

import numpy as np
import pandas as pd

from . import util
from .snapshot import _clean, build_snapshot
from .store import DataStore

log = logging.getLogger(__name__)

WARMUP_DAYS = 250          # 第一個訊號日之前至少要有幾個交易日（240 日均線、52 週高低）
# 快照裡回測用不到、又佔空間的欄位
DROP = {"date", "prev_close", "dif", "dea", "ma5", "ma10", "ma120", "n_days", "fin_period", "rev_month",
        "holders", "holders_chg", "big400_pct", "daytrade_lots", "daytrade_ratio", "sbl_sell_lots", "sbl_balance_lots",
        "block_value", "hs_profit", "hs_liquid", "hs_struct", "hs_eff", "hs_growth", "gm_min5y", "gm_max5y",
        "industry", "pe_calc", "stale"}


# ---------------- 只看得到「當時」資料的資料庫 ----------------

def fin_available(qdate: pd.Series) -> pd.Series:
    """季底日期 → 法定公布期限（之後才可用）。"""
    y, m = qdate.dt.year, qdate.dt.month
    out = pd.Series(pd.NaT, index=qdate.index)
    out[m == 3] = pd.to_datetime(y[m == 3].astype(str) + "-05-15")
    out[m == 6] = pd.to_datetime(y[m == 6].astype(str) + "-08-14")
    out[m == 9] = pd.to_datetime(y[m == 9].astype(str) + "-11-14")
    out[m == 12] = pd.to_datetime((y[m == 12] + 1).astype(str) + "-03-31")
    return out


class _CachedStorage:
    """同一次執行裡重複讀同一個檔案只抓一次。"""

    def __init__(self, st):
        self.st, self._get, self._list = st, {}, {}

    def get(self, path):
        if path not in self._get:
            self._get[path] = self.st.get(path)
        return self._get[path]

    def list(self, prefix):
        if prefix not in self._list:
            self._list[prefix] = self.st.list(prefix)
        return self._list[prefix]

    def __getattr__(self, k):
        return getattr(self.st, k)


class PitStore(DataStore):
    """point-in-time：讀表時只回傳 asof 當時已經公布的資料。"""

    def __init__(self, base: DataStore, asof: pd.Timestamp):
        super().__init__(base.st, base.prefix)
        self.asof = pd.Timestamp(asof)
        self._tables = {}

    def read_daily(self, name, start=None, end=None):
        end = min(pd.Timestamp(end), self.asof) if end is not None else self.asof
        return super().read_daily(name, start, end)

    def read_table(self, name):
        if name not in self._tables:
            self._tables[name] = self._filter(name, super().read_table(name))
        return self._tables[name]

    def _filter(self, name, df):
        if df.empty:
            return df
        if name in ("income", "balance", "cashflow"):
            return df[fin_available(pd.to_datetime(df["date"])) <= self.asof].reset_index(drop=True)
        if name in ("revenue", "revenue_latest"):
            avail = pd.to_datetime(pd.DataFrame({"year": df["year"], "month": df["month"], "day": 1})) + pd.DateOffset(months=1, days=9)
            return df[avail <= self.asof].reset_index(drop=True)
        if name == "dividend":
            return df[pd.to_datetime(df["date"]) <= self.asof].reset_index(drop=True)
        if name == "income_periods":
            return df.iloc[0:0]
        return df


# ---------------- 月份與交易日 ----------------

def trading_days(store: DataStore) -> pd.DatetimeIndex:
    idx = store.read_daily("index")
    if idx.empty:
        return pd.DatetimeIndex([])
    return pd.DatetimeIndex(sorted(pd.to_datetime(idx["date"]).unique()))


def rebalance_months(days: pd.DatetimeIndex) -> list[dict]:
    """每個月最後一個交易日＝訊號日；下一個交易日＝成交日（用開盤價）。只列成交日已經發生的月份。"""
    if len(days) <= WARMUP_DAYS:
        return []
    s = pd.Series(days, index=days)
    last = s.groupby(s.dt.to_period("M")).max()
    out = []
    for sig in last:
        i = days.get_loc(sig)
        if i < WARMUP_DAYS or i + 1 >= len(days):
            continue
        out.append({"month": sig.strftime("%Y-%m"), "signal": sig.strftime("%Y-%m-%d"),
                    "exec": days[i + 1].strftime("%Y-%m-%d")})
    return out


# ---------------- 輸出 ----------------

def _put_gz(store: DataStore, path: str, obj) -> int:
    data = gzip.compress(json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    store.st.put(path, data, "application/gzip")
    return len(data)


def month_snapshot(store: DataStore, signal: str) -> tuple[pd.DataFrame, dict]:
    asof = pd.Timestamp(signal)
    df, meta = build_snapshot(PitStore(store, asof), asof)
    df = df[(df["sec_type"] == "stock") & (df["date"] == asof)] if "date" in df else df[df["sec_type"] == "stock"]
    df = df.drop(columns=[c for c in df.columns if c in DROP])
    return df, meta


def write_month(store: DataStore, m: dict) -> int:
    df, meta = month_snapshot(store, m["signal"])
    rows = [[_clean(v) for v in r] for r in df.itertuples(index=False, name=None)]
    meta = {**{k: v for k, v in meta.items() if k in ("asof", "taiex", "taiex_ma200", "market_bull")}, **m}
    return _put_gz(store, f"site/bt/snap/{m['month']}.json.gz", {"meta": meta, "columns": list(df.columns), "rows": rows})


def forward_adjusted(prices: pd.DataFrame, exright: pd.DataFrame) -> pd.DataFrame:
    """向前還原：除以「到當天為止所有事件比率」的連乘。"""
    p = prices[["date", "code", "open", "close"]].copy().sort_values(["code", "date"])
    p["r"] = 1.0
    if exright is not None and not exright.empty:
        ev = exright[(exright["prev_close"] > 0) & (exright["ref_price"] > 0)].copy()
        ev["ratio"] = ev["ref_price"] / ev["prev_close"]
        ev = ev[(ev["ratio"] > 0.05) & (ev["ratio"] < 20)].groupby(["date", "code"], as_index=False)["ratio"].prod()
        p = p.merge(ev, on=["date", "code"], how="left")
        p["r"] = p["ratio"].fillna(1.0)
    cum = p.groupby("code")["r"].cumprod()
    p["aopen"] = p["open"] / cum
    p["aclose"] = p["close"] / cum
    return p


def _sig(x) -> float | None:
    """保留 6 位有效數字，縮小檔案。"""
    if x is None or not np.isfinite(x):
        return None
    return float(f"{x:.6g}")


BENCH_ETFS = ["0050"]
PX_VER = 2          # 價格檔格式版本：2＝加入 0050；版本變了就全部重做


def write_prices(store: DataStore, days: pd.DatetimeIndex, months: list[dict], years: list[int] | None = None) -> dict:
    """依年份輸出價格檔；years=None 表示全部重做。"""
    prices = store.read_daily("prices", days[0], days[-1])
    # 普通股＋0050（0050 只當比較基準；回測快照裡沒有它，策略不會選到）
    prices = prices[(prices["code"].map(util.security_type) == "stock") | prices["code"].isin(BENCH_ETFS)]
    adj = forward_adjusted(prices, store.read_daily("exright", days[0], days[-1]))
    idx = store.read_daily("index").sort_values("date").set_index("date")
    execs = {m["exec"] for m in months}
    sizes = {}
    for y in sorted(set(days.year)):
        if years is not None and y not in years:
            continue
        a = adj[adj["date"].dt.year == y]
        if a.empty:
            continue
        close = a.pivot_table(index="date", columns="code", values="aclose", aggfunc="last").sort_index()
        opn = a.pivot_table(index="date", columns="code", values="aopen", aggfunc="last")
        codes = list(close.columns)
        dates = [d.strftime("%Y-%m-%d") for d in close.index]
        ex = {d: [_sig(v) for v in opn.loc[pd.Timestamp(d)].reindex(codes).values]
              for d in dates if d in execs and pd.Timestamp(d) in opn.index}
        bench = idx["taiex_tr"].reindex(close.index) if "taiex_tr" in idx else pd.Series(np.nan, index=close.index)
        obj = {"year": y, "dates": dates, "codes": codes,
               "close": [[_sig(v) for v in row] for row in close.values],
               "open": ex, "bench": [_sig(v) for v in bench.values]}
        sizes[y] = _put_gz(store, f"site/bt/px/{y}.json.gz", obj)
    return sizes


def run_backtest_data(store: DataStore, budget_min: float = 40, rebuild: bool = False) -> dict:
    """增量：已做過的月份跳過；價格檔只重做今年（第一次或 rebuild 時全部重做）。"""
    t0 = time.time()
    cached = DataStore(_CachedStorage(store.st), store.prefix)
    days = trading_days(cached)
    months = rebalance_months(days)
    state = {} if rebuild else store.get_state("backtest", {})
    done = set(state.get("months", []))
    if done and not rebuild:
        # 平常只往後增量；往前延長（補了更早的歷史後）要用 rebuild，確保財報也已補齊
        months = [m for m in months if m["month"] >= min(done)]
    built, failed = [], []
    for m in reversed(months):                     # 由新到舊，先有近期可用
        if m["month"] in done:
            continue
        if time.time() - t0 > budget_min * 60:
            break
        try:
            size = write_month(cached, m)
            done.add(m["month"])
            built.append(m["month"])
            log.info("回測快照 %s：%.0f KB", m["month"], size / 1024)
        except Exception as e:  # noqa: BLE001
            failed.append(m["month"])
            log.exception("回測快照 %s 失敗：%s", m["month"], e)
        store.put_state("backtest", {**state, "months": sorted(done)})
    first_px = not state.get("px_done")
    years = None if (first_px or rebuild or state.get("px_ver") != PX_VER) else [days[-1].year, (days[-1] - pd.Timedelta(days=40)).year]
    sizes = write_prices(cached, days, months, years)
    ready = [m for m in months if m["month"] in done]
    store.st.put("site/bt/index.json", json.dumps({
        "generated_at": util.now_tw().isoformat(timespec="seconds"),
        "months": ready, "years": sorted({int(y) for y in days.year}),
        "first_day": days[0].strftime("%Y-%m-%d"), "last_day": days[-1].strftime("%Y-%m-%d"),
        "pending": len(months) - len(ready),
    }, ensure_ascii=False).encode("utf-8"), "application/json")
    store.put_state("backtest", {**state, "months": sorted(done), "px_done": True, "px_ver": PX_VER})
    return {"built": built, "failed": failed, "ready": len(ready), "total": len(months),
            "px_kb": {y: round(s / 1024) for y, s in sizes.items()}, "minutes": round((time.time() - t0) / 60, 1)}
