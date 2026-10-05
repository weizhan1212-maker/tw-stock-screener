"""
篩選快照：把每檔股票「最新一天」的所有篩選指標算好，存成一個檔案給網站讀。
    site/snapshot.json.gz  →  {"meta": {...}, "columns": [...], "rows": [[...], ...]}

指標分四類：
- 價量／技術面：用還原股價計算（除權息不會造成假跌破）
- 估值：本益比、股價淨值比、殖利率、股價營收比、市值
- 籌碼：三大法人買賣超（張）、連買天數、外資持股比、融資融券
- 基本面：EPS、營收成長、三率、ROE、ROA、負債比、流動比率、自由現金流、連續配息年數
"""
import gzip
import json
import logging
import math

import numpy as np
import pandas as pd

from . import util
from .factors import finish, strategy_factors
from .store import DataStore

log = logging.getLogger(__name__)
SNAPSHOT_PATH = "site/snapshot.json.gz"


# ---------------- 還原股價 ----------------

def adjust_factors(prices: pd.DataFrame, exright: pd.DataFrame) -> pd.Series:
    """
    回傳每列的還原因子：還原價 = 原始價 × 因子。
    事件（除權息、減資等）當天以前的價格乘上 參考價 ÷ 前收盤，多次事件連乘。
    """
    p = prices[["date", "code"]].copy()
    p["r"] = 1.0
    if exright is not None and not exright.empty:
        ev = exright[(exright["prev_close"] > 0) & (exright["ref_price"] > 0)].copy()
        ev["ratio"] = ev["ref_price"] / ev["prev_close"]
        ev = ev[(ev["ratio"] > 0.05) & (ev["ratio"] < 20)]           # 排除明顯錯誤的資料
        ev = ev.groupby(["date", "code"], as_index=False)["ratio"].prod()
        p = p.merge(ev, on=["date", "code"], how="left")
        p["r"] = p["ratio"].fillna(1.0)
    p = p.sort_values(["code", "date"])
    # 因子_t = 所有「t 之後」事件比率的連乘 = (從尾端累乘含 t) ÷ r_t
    rev_cum = p.iloc[::-1].groupby("code")["r"].cumprod().iloc[::-1]
    factor = rev_cum / p["r"]
    return factor.reindex(prices.index)


# ---------------- 技術指標 ----------------

def _streak_positive(s: pd.Series) -> int:
    """從最後一天往前數，連續 > 0 的天數。"""
    n = 0
    for v in s.iloc[::-1]:
        if v > 0:
            n += 1
        else:
            break
    return n


def technicals(px: pd.DataFrame) -> pd.DataFrame:
    """px：單一市場全部股票的日資料（已含還原價 aclose/ahigh/alow），回傳每檔最後一天的指標。"""
    px = px.sort_values(["code", "date"]).copy()
    g = px.groupby("code", sort=False)
    c = px["aclose"]
    for w in (5, 10, 20, 60, 120, 240):
        px[f"ma{w}"] = g["aclose"].transform(lambda s, w=w: s.rolling(w, min_periods=w).mean())
    for n in (5, 20, 60, 120):
        px[f"ret{n}"] = (c / g["aclose"].shift(n) - 1) * 100
    px["high52"] = g["ahigh"].transform(lambda s: s.rolling(240, min_periods=120).max())
    px["low52"] = g["alow"].transform(lambda s: s.rolling(240, min_periods=120).min())
    px["dist_high52"] = (c / px["high52"] - 1) * 100
    px["dist_low52"] = (c / px["low52"] - 1) * 100
    px["high20"] = g["aclose"].transform(lambda s: s.rolling(20, min_periods=20).max())
    px["high60"] = g["aclose"].transform(lambda s: s.rolling(60, min_periods=60).max())
    px["new_high20"] = (c >= px["high20"]).astype(float).where(px["high20"].notna())
    px["new_high60"] = (c >= px["high60"]).astype(float).where(px["high60"].notna())
    px["vol_ma20"] = g["volume"].transform(lambda s: s.shift(1).rolling(20, min_periods=10).mean())
    px["vol_ratio"] = px["volume"] / px["vol_ma20"]
    # KD(9,3,3)
    lo9 = g["alow"].transform(lambda s: s.rolling(9, min_periods=9).min())
    hi9 = g["ahigh"].transform(lambda s: s.rolling(9, min_periods=9).max())
    px["rsv"] = ((c - lo9) / (hi9 - lo9) * 100).where(hi9 > lo9, 50)
    px["k"] = px.groupby("code", sort=False)["rsv"].transform(lambda s: s.ewm(alpha=1 / 3, adjust=False).mean())
    px["d"] = px.groupby("code", sort=False)["k"].transform(lambda s: s.ewm(alpha=1 / 3, adjust=False).mean())
    # MACD(12,26,9)
    e12 = g["aclose"].transform(lambda s: s.ewm(span=12, adjust=False).mean())
    e26 = g["aclose"].transform(lambda s: s.ewm(span=26, adjust=False).mean())
    px["dif"] = e12 - e26
    px["dea"] = px.groupby("code", sort=False)["dif"].transform(lambda s: s.ewm(span=9, adjust=False).mean())
    px["macd_hist"] = px["dif"] - px["dea"]
    # RSI(14)，Wilder 平滑
    diff = g["aclose"].diff()
    up = diff.clip(lower=0).groupby(px["code"]).transform(lambda s: s.ewm(alpha=1 / 14, adjust=False).mean())
    dn = (-diff.clip(upper=0)).groupby(px["code"]).transform(lambda s: s.ewm(alpha=1 / 14, adjust=False).mean())
    px["rsi14"] = 100 - 100 / (1 + up / dn.replace(0, np.nan))
    # 布林通道(20,2) %b
    sd20 = g["aclose"].transform(lambda s: s.rolling(20, min_periods=20).std())
    px["boll_pctb"] = (c - (px["ma20"] - 2 * sd20)) / (4 * sd20) * 100
    px["n_days"] = g.cumcount() + 1
    # 前一天的 K、D、DIF、DEA（用來判斷黃金交叉）
    for col in ("k", "d", "dif", "dea"):
        px[f"{col}_prev"] = px.groupby("code", sort=False)[col].shift(1)
    last = px.groupby("code", sort=False).tail(1).set_index("code")
    prev_close = g["close"].shift(1)
    px["chg_pct"] = (px["aclose"] / g["aclose"].shift(1) - 1) * 100
    last["chg_pct"] = px.groupby("code", sort=False)["chg_pct"].last()
    last["prev_close"] = prev_close.groupby(px["code"]).last()
    last["bull_align"] = ((last["aclose"] > last["ma5"]) & (last["ma5"] > last["ma20"])
                          & (last["ma20"] > last["ma60"])).astype(float).where(last["ma60"].notna())
    last["kd_golden"] = ((last["k_prev"] <= last["d_prev"]) & (last["k"] > last["d"])).astype(float)
    last["macd_golden"] = ((last["dif_prev"] <= last["dea_prev"]) & (last["dif"] > last["dea"])).astype(float)
    return last


# ---------------- 籌碼 ----------------

def chips(insti: pd.DataFrame, margin: pd.DataFrame, qfii: pd.DataFrame) -> pd.DataFrame:
    out = pd.DataFrame()
    if not insti.empty:
        it = insti.sort_values(["code", "date"])
        g = it.groupby("code")
        res = {}
        for who in ("foreign", "trust", "dealer", "total"):
            lots = it[who] / 1000                                       # 股 → 張
            res[f"{who}_net"] = lots.groupby(it["code"]).last()
            res[f"{who}_net5"] = lots.groupby(it["code"]).apply(lambda s: s.tail(5).sum())
            res[f"{who}_net20"] = lots.groupby(it["code"]).apply(lambda s: s.tail(20).sum())
        for who in ("foreign", "trust"):
            res[f"{who}_buy_streak"] = g[who].apply(_streak_positive)
        out = pd.DataFrame(res)
    if not margin.empty:
        m = margin.sort_values(["code", "date"])
        mg = m.groupby("code")
        mm = pd.DataFrame({
            "margin_balance": mg["margin_balance"].last(),
            "margin_chg5": mg["margin_balance"].last() - mg["margin_balance"].apply(
                lambda s: s.iloc[-6] if len(s) >= 6 else np.nan),
            "short_balance": mg["short_balance"].last(),
        })
        mm["short_margin_ratio"] = (mm["short_balance"] / mm["margin_balance"].replace(0, np.nan)) * 100
        out = out.join(mm, how="outer")
    if not qfii.empty:
        q = qfii.sort_values(["code", "date"]).groupby("code").last()
        out = out.join(q[["foreign_ratio"]], how="outer")
    return out


# ---------------- 基本面 ----------------

def _pivot(df: pd.DataFrame, types) -> pd.DataFrame:
    sub = df[df["type"].isin(types)]
    if sub.empty:
        return pd.DataFrame(columns=["code", "date", *types])
    p = sub.pivot_table(index=["code", "date"], columns="type", values="value", aggfunc="last").reset_index()
    for t in types:
        if t not in p:
            p[t] = np.nan
    return p.sort_values(["code", "date"])


def _decumulate(cf: pd.DataFrame, cols) -> pd.DataFrame:
    """現金流量表是年初累計數，拆成單季：Q2 = 上半年 − Q1，以此類推。"""
    cf = cf.sort_values(["code", "date"]).copy()
    cf["year"] = cf["date"].dt.year
    for c in cols:
        prev = cf.groupby(["code", "year"])[c].shift(1)
        cf[c] = cf[c] - prev.fillna(0)
    return cf


def fundamentals(store: DataStore, asof: pd.Timestamp) -> pd.DataFrame:
    out = []
    inc = store.read_table("income")
    if not inc.empty:
        q = _pivot(inc, ["Revenue", "GrossProfit", "OperatingIncome", "IncomeAfterTaxes",
                         "EquityAttributableToOwnersOfParent", "EPS"])
        g = q.groupby("code")
        last4 = g.tail(4)
        n4 = last4.groupby("code").size()
        ttm = last4.groupby("code")[["Revenue", "IncomeAfterTaxes", "EquityAttributableToOwnersOfParent", "EPS"]].sum()
        ttm = ttm.where(n4 == 4)
        lastq = g.tail(1).set_index("code")
        yago = g.apply(lambda s: s.iloc[-5] if len(s) >= 5 else pd.Series(dtype=float), include_groups=False)
        f = pd.DataFrame({
            "fin_period": lastq["date"].dt.strftime("%Y") + "Q" + ((lastq["date"].dt.month - 1) // 3 + 1).astype(str),
            "eps_q": lastq["EPS"],
            "eps_ttm": ttm["EPS"],
            "gross_margin": lastq["GrossProfit"] / lastq["Revenue"] * 100,
            "op_margin": lastq["OperatingIncome"] / lastq["Revenue"] * 100,
            "net_margin": lastq["IncomeAfterTaxes"] / lastq["Revenue"] * 100,
            "_ni_ttm": ttm["IncomeAfterTaxes"],
            "_ni_owner_ttm": ttm["EquityAttributableToOwnersOfParent"],
            "_rev_q_ttm": ttm["Revenue"],
        })
        if isinstance(yago, pd.DataFrame) and "EPS" in yago:
            f["eps_q_yoy"] = (lastq["EPS"] - yago["EPS"]) / yago["EPS"].abs() * 100
        # 近 5 年每年 ROE、毛利率穩定度等「長期」條件：近 20 季
        yearly = q.assign(year=q["date"].dt.year).groupby(["code", "year"]).agg(
            eps_y=("EPS", "sum"), n=("EPS", "size"), gp=("GrossProfit", "sum"), rev=("Revenue", "sum"))
        yearly = yearly[yearly["n"] == 4].reset_index()
        yearly["gm"] = yearly["gp"] / yearly["rev"] * 100
        last5 = yearly.groupby("code").tail(5)
        agg = last5.groupby("code").agg(eps_min5y=("eps_y", "min"), years_fin=("eps_y", "size"),
                                        gm_min5y=("gm", "min"), gm_max5y=("gm", "max"))
        f = f.join(agg)
        f["gm_stability"] = (f["gm_min5y"] / f["gm_max5y"] * 100).where(f["gm_max5y"] > 0)
        out.append(f)

    bal = store.read_table("balance")
    if not bal.empty:
        b = _pivot(bal, ["TotalAssets", "Liabilities", "CurrentAssets", "CurrentLiabilities",
                         "EquityAttributableToOwnersOfParent", "Equity"])
        gb = b.groupby("code")
        lb = gb.tail(1).set_index("code")
        eq_owner = lb["EquityAttributableToOwnersOfParent"].fillna(lb["Equity"])
        out.append(pd.DataFrame({
            "debt_ratio": lb["Liabilities"] / lb["TotalAssets"] * 100,
            "current_ratio": lb["CurrentAssets"] / lb["CurrentLiabilities"],
            "_equity": eq_owner, "_assets": lb["TotalAssets"],
        }))

    cf = store.read_table("cashflow")
    if not cf.empty:
        c = _pivot(cf, ["CashFlowsFromOperatingActivities", "PropertyAndPlantAndEquipment"])
        c = _decumulate(c, ["CashFlowsFromOperatingActivities", "PropertyAndPlantAndEquipment"])
        c["fcf"] = c["CashFlowsFromOperatingActivities"] + c["PropertyAndPlantAndEquipment"].fillna(0)
        last4 = c.groupby("code").tail(4)
        n4 = last4.groupby("code").size()
        fcf = last4.groupby("code")["fcf"].sum().where(n4 == 4)
        c["year"] = c["date"].dt.year
        yfcf = c.groupby(["code", "year"]).agg(fcf=("fcf", "sum"), n=("fcf", "size")).reset_index()
        yfcf = yfcf[yfcf["n"] == 4].groupby("code").tail(3)
        out.append(pd.DataFrame({"fcf_ttm": fcf, "fcf_min3y": yfcf.groupby("code")["fcf"].min()}))

    rev = pd.concat([store.read_table("revenue"), store.read_table("revenue_latest")], ignore_index=True)
    if not rev.empty:
        rev = rev.drop_duplicates(["code", "year", "month"], keep="last").sort_values(["code", "year", "month"])
        rev["ym"] = rev["year"] * 12 + rev["month"]
        key = rev[["code", "ym", "revenue"]]
        rev = rev.merge(key.assign(ym=key["ym"] + 12).rename(columns={"revenue": "rev_ly"}), on=["code", "ym"], how="left")
        rev = rev.merge(key.assign(ym=key["ym"] + 1).rename(columns={"revenue": "rev_lm"}), on=["code", "ym"], how="left")
        rev["yoy"] = (rev["revenue"] / rev["rev_ly"] - 1) * 100
        rev["mom"] = (rev["revenue"] / rev["rev_lm"] - 1) * 100
        gr = rev.groupby("code")
        last3 = gr.tail(3)
        last12 = gr.tail(12)
        n12 = last12.groupby("code").size()
        lr = gr.tail(1).set_index("code")
        out.append(pd.DataFrame({
            "rev_month": lr["year"].astype(str) + "-" + lr["month"].astype(str).str.zfill(2),
            "rev_yoy": lr["yoy"], "rev_mom": lr["mom"],
            "rev_yoy_min3": last3.groupby("code")["yoy"].min().where(last3.groupby("code").size() == 3),
            "_rev_ttm": last12.groupby("code")["revenue"].sum().where(n12 == 12),
        }))

    div = store.read_table("dividend")
    if not div.empty:
        d = div.copy()
        d["roc_year"] = pd.to_numeric(d["period"].str.extract(r"^(\d{2,3})")[0], errors="coerce")
        y = d.groupby(["code", "roc_year"])["cash"].sum().reset_index().sort_values(["code", "roc_year"])

        def streak(s):
            n, prev = 0, None
            for yr, v in zip(s["roc_year"].iloc[::-1], s["cash"].iloc[::-1]):
                if v <= 0 or (prev is not None and yr != prev - 1):
                    break
                n += 1
                prev = yr
            return n
        out.append(pd.DataFrame({"div_years": y.groupby("code").apply(streak, include_groups=False),
                                 "cash_div_last": y.groupby("code")["cash"].last()}))
    if not out:
        return pd.DataFrame()
    f = out[0]
    for x in out[1:]:
        f = f.join(x, how="outer")
    return f


# ---------------- 組合 ----------------

def build_snapshot(store: DataStore, asof=None, lookback_days: int = 420) -> tuple[pd.DataFrame, dict]:
    days = store.get_state("days", {})
    if asof is None:
        done = [d for d, s in days.items() if isinstance(s, dict) and s.get("twse_quotes") == "ok"]
        asof = max(done) if done else util.today_tw().isoformat()
    asof = pd.Timestamp(asof)
    start = asof - pd.Timedelta(days=lookback_days)

    prices = store.read_daily("prices", start, asof)
    if prices.empty:
        raise RuntimeError("沒有價格資料")
    exr = store.read_daily("exright", start, asof + pd.Timedelta(days=1))
    prices = prices.reset_index(drop=True)
    fac = adjust_factors(prices, exr)
    for col in ("open", "high", "low", "close"):
        prices[f"a{col}"] = prices[col] * fac
    # 沒成交的日子（收盤空白）用前一天補，避免指標斷掉
    prices = prices.sort_values(["code", "date"])
    for col in ("aclose", "ahigh", "alow"):
        prices[col] = prices.groupby("code")[col].ffill()
    prices["volume"] = prices["volume"].fillna(0)

    tech = technicals(prices)
    tech = tech.rename(columns={"aclose": "adj_close"})
    base = tech[["date", "market", "name", "close", "prev_close", "chg_pct", "volume", "value", "adj_close",
                 "ma5", "ma10", "ma20", "ma60", "ma120", "ma240", "ret5", "ret20", "ret60", "ret120",
                 "dist_high52", "dist_low52", "new_high20", "new_high60", "vol_ratio", "k", "d", "kd_golden",
                 "dif", "dea", "macd_hist", "macd_golden", "rsi14", "boll_pctb", "bull_align", "n_days",
                 *(["shares_issued"] if "shares_issued" in tech else [])]].copy()
    base["volume_lots"] = base.pop("volume") / 1000
    base["stale"] = (base["date"] < asof).astype(int)              # 今天沒交易（停牌等）

    win = asof - pd.Timedelta(days=45)
    val = store.read_daily("valuation", asof - pd.Timedelta(days=10), asof)
    if not val.empty:
        base = base.join(val.sort_values("date").groupby("code")[["pe", "pb", "dividend_yield"]].last())
    base = base.join(chips(store.read_daily("insti", win, asof), store.read_daily("margin", win, asof),
                           store.read_daily("qfii", asof - pd.Timedelta(days=10), asof)))

    sec = store.read_table("securities")
    if not sec.empty:
        base = base.join(sec.set_index("code")[["industry", "sec_type"]])
    comp = store.read_table("company")
    shares = pd.Series(dtype=float)
    if not comp.empty:
        shares = comp.set_index("code")["shares_issued"]
    if "shares_issued" in base:
        shares = shares.combine_first(base["shares_issued"]) if not shares.empty else base["shares_issued"]
    base["market_cap"] = base["close"] * shares.reindex(base.index) / 1e8   # 億元

    fund = fundamentals(store, asof)
    if not fund.empty:
        base = base.join(fund)
        if "_rev_ttm" in base:
            base["psr"] = base["market_cap"] * 1e8 / base["_rev_ttm"]
        if "_ni_owner_ttm" in base and "_equity" in base:
            base["roe"] = base["_ni_owner_ttm"] / base["_equity"] * 100
        if "_ni_ttm" in base and "_assets" in base:
            base["roa"] = base["_ni_ttm"] / base["_assets"] * 100
        if "eps_ttm" in base:
            base["pe_calc"] = (base["close"] / base["eps_ttm"]).where(base["eps_ttm"] > 0)
    sf = strategy_factors(store)
    if not sf.empty:
        base = base.join(sf)
    base = finish(base)
    base["sec_type"] = base.get("sec_type", pd.Series(index=base.index, dtype=object)).fillna(
        base.index.to_series().map(util.security_type))
    base = base.drop(columns=[c for c in base.columns if c.startswith("_")] + ["shares_issued"], errors="ignore")
    base = base.reset_index().rename(columns={"index": "code"})
    meta = {"asof": asof.strftime("%Y-%m-%d"), "generated_at": util.now_tw().isoformat(timespec="seconds"),
            "count": int(len(base)), "fin_complete": bool(store.get_state("finmind_backfill", {}).get("_complete")),
            **market_state(store, asof)}
    return base, meta


def market_state(store: DataStore, asof: pd.Timestamp) -> dict:
    """大盤狀態：加權指數與 200 日均線（CAN SLIM 的 M 條件）。"""
    idx = store.read_daily("index", asof - pd.Timedelta(days=330), asof)
    if idx.empty or "taiex" not in idx:
        return {}
    s = idx.sort_values("date")["taiex"].dropna()
    out = {"taiex": round(float(s.iloc[-1]), 2)}
    if len(s) >= 200:
        ma = float(s.tail(200).mean())
        out.update(taiex_ma200=round(ma, 2), market_bull=bool(s.iloc[-1] > ma))
    return out


def _clean(v):
    if v is None:
        return None
    if isinstance(v, (float, np.floating)):
        if math.isnan(v) or math.isinf(v):
            return None
        return round(float(v), 4) if abs(v) < 100 else round(float(v), 2)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, pd.Timestamp):
        return v.strftime("%Y-%m-%d")
    return v


def write_snapshot(store: DataStore, df: pd.DataFrame, meta: dict) -> int:
    cols = list(df.columns)
    rows = [[_clean(v) for v in r] for r in df.itertuples(index=False, name=None)]
    payload = json.dumps({"meta": meta, "columns": cols, "rows": rows}, ensure_ascii=False,
                         separators=(",", ":")).encode("utf-8")
    data = gzip.compress(payload)
    store.st.put(SNAPSHOT_PATH, data, "application/gzip")
    log.info("快照：%d 檔、%d 欄，壓縮後 %.0f KB", len(df), len(cols), len(data) / 1024)
    return len(data)
