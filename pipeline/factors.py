"""
大師策略需要的進階指標（加進篩選快照）：
- 神奇公式：EBIT（以營業利益近似）、有息負債、現金、淨營運資金、固定資產 → 盈餘殖利率、資本報酬率
- 德雷曼：營業現金流（算股價現金流比）
- 彼得林區／聶夫：近 3 年 EPS 年複合成長率
- 葛拉漢：近 3 年平均 EPS ÷ 前 3 年平均 EPS
- CAN SLIM：近 3 年年度 EPS 是否逐年成長
- 巴菲特：近 5 年每年 ROE 的最低值
- 皮爾托斯基 F-Score：9 項財務健康分數（近四季 vs 前四季）
- 費雪：近 12 個月營收年增率
- 產業旗標：金融保險、公用事業（神奇公式等策略要排除）
"""
import numpy as np
import pandas as pd

from .store import DataStore

DEBT_TYPES = ["ShorttermBorrowings", "ShortTermBorrowings", "ShorttermNotesAndBillsPayable",
              "CurrentPortionOfLongtermBorrowings", "LongtermBorrowings", "BondsPayable"]
LT_DEBT_TYPES = ["LongtermBorrowings", "BondsPayable"]


def _pivot(df: pd.DataFrame, types) -> pd.DataFrame:
    sub = df[df["type"].isin(types)]
    if sub.empty:
        return pd.DataFrame(columns=["code", "date", *types])
    p = sub.pivot_table(index=["code", "date"], columns="type", values="value", aggfunc="last").reset_index()
    for t in types:
        if t not in p:
            p[t] = np.nan
    return p.sort_values(["code", "date"]).reset_index(drop=True)


def _decumulate(cf: pd.DataFrame, cols) -> pd.DataFrame:
    cf = cf.sort_values(["code", "date"]).copy()
    cf["year"] = cf["date"].dt.year
    for c in cols:
        prev = cf.groupby(["code", "year"])[c].shift(1)
        cf[c] = cf[c] - prev.fillna(0)
    return cf


def _ttm(df: pd.DataFrame, cols, offset: int = 0) -> pd.DataFrame:
    """每檔最近四季合計（offset=4 代表再往前四季）。不足四季為 NaN。"""
    def f(g):
        g = g.iloc[: len(g) - offset] if offset else g
        last4 = g.tail(4)
        if len(last4) < 4:
            return pd.Series({c: np.nan for c in cols})
        return last4[cols].sum(min_count=4)
    return df.groupby("code").apply(f, include_groups=False)


def _at(df: pd.DataFrame, cols, back: int = 0) -> pd.DataFrame:
    """每檔倒數第 back+1 季的數值（資產負債表用）。"""
    def f(g):
        if len(g) <= back:
            return pd.Series({c: np.nan for c in cols})
        return g.iloc[-1 - back][cols]
    return df.groupby("code").apply(f, include_groups=False)


def strategy_factors(store: DataStore) -> pd.DataFrame:
    out = []
    inc = store.read_table("income")
    bal = store.read_table("balance")
    cf = store.read_table("cashflow")

    if not inc.empty:
        q = _pivot(inc, ["Revenue", "GrossProfit", "OperatingIncome", "IncomeAfterTaxes",
                         "EquityAttributableToOwnersOfParent", "EPS"])
        cols = ["Revenue", "GrossProfit", "OperatingIncome", "IncomeAfterTaxes", "EquityAttributableToOwnersOfParent"]
        now = _ttm(q, cols)
        prev = _ttm(q, cols, offset=4)
        f = pd.DataFrame({"ebit_ttm": now["OperatingIncome"]})

        # 年度 EPS（只用四季齊全的年度）
        y = q.assign(year=q["date"].dt.year).groupby(["code", "year"]).agg(
            eps=("EPS", "sum"), n=("EPS", "size"), ni=("EquityAttributableToOwnersOfParent", "sum"))
        y = y[y["n"] == 4].reset_index()

        def eps_stats(g):
            e = g["eps"].tolist()
            r = {"eps_cagr3": np.nan, "eps_growth_3v3": np.nan, "eps_up3y": np.nan}
            if len(e) >= 4 and e[-1] > 0 and e[-4] > 0:
                r["eps_cagr3"] = ((e[-1] / e[-4]) ** (1 / 3) - 1) * 100
            if len(e) >= 6:
                a, b = np.mean(e[-3:]), np.mean(e[-6:-3])
                if b > 0:
                    r["eps_growth_3v3"] = a / b
            if len(e) >= 3:
                r["eps_up3y"] = float(e[-3] < e[-2] < e[-1])
            return pd.Series(r)
        f = f.join(y.groupby("code").apply(eps_stats, include_groups=False))
        out.append(f)

        # 年度 ROE（年度淨利 ÷ 年底權益）
        if not bal.empty:
            b = _pivot(bal, ["EquityAttributableToOwnersOfParent", "Equity"])
            b = b[b["date"].dt.month == 12].assign(year=lambda d: d["date"].dt.year)
            b["eq"] = b["EquityAttributableToOwnersOfParent"].fillna(b["Equity"])
            yr = y.merge(b[["code", "year", "eq"]], on=["code", "year"], how="inner")
            yr["roe_y"] = yr["ni"] / yr["eq"] * 100
            last5 = yr.sort_values("year").groupby("code").tail(5)
            agg = last5.groupby("code").agg(roe_min5y=("roe_y", "min"), n=("roe_y", "size"))
            out.append(agg["roe_min5y"].where(agg["n"] == 5).to_frame())

    cfo_now = cfo_prev = None
    if not cf.empty:
        c = _decumulate(_pivot(cf, ["CashFlowsFromOperatingActivities"]), ["CashFlowsFromOperatingActivities"])
        cfo_now = _ttm(c, ["CashFlowsFromOperatingActivities"])["CashFlowsFromOperatingActivities"]
        cfo_prev = _ttm(c, ["CashFlowsFromOperatingActivities"], offset=4)["CashFlowsFromOperatingActivities"]
        out.append(pd.DataFrame({"cfo_ttm": cfo_now}))

    if not bal.empty:
        types = ["TotalAssets", "CurrentAssets", "CurrentLiabilities", "PropertyPlantAndEquipment",
                 "CashAndCashEquivalents", "OrdinaryShare", *DEBT_TYPES]
        b = _pivot(bal, list(dict.fromkeys(types)))
        b["_debt"] = b[[t for t in DEBT_TYPES if t in b]].fillna(0).sum(axis=1)
        b["_lt_debt"] = b[[t for t in LT_DEBT_TYPES if t in b]].fillna(0).sum(axis=1)
        cols = ["TotalAssets", "CurrentAssets", "CurrentLiabilities", "PropertyPlantAndEquipment",
                "CashAndCashEquivalents", "OrdinaryShare", "_debt", "_lt_debt"]
        bn, bp = _at(b, cols), _at(b, cols, back=4)
        out.append(pd.DataFrame({
            "_debt": bn["_debt"], "_cash": bn["CashAndCashEquivalents"].fillna(0),
            "_nwc": bn["CurrentAssets"] - bn["CurrentLiabilities"], "_ppe": bn["PropertyPlantAndEquipment"].fillna(0),
        }))

        # 皮爾托斯基 F-Score
        if not inc.empty and cfo_now is not None:
            idx = bn.index
            roa_now = now["IncomeAfterTaxes"].reindex(idx) / bn["TotalAssets"]
            roa_prev = prev["IncomeAfterTaxes"].reindex(idx) / bp["TotalAssets"]
            cfo_n = cfo_now.reindex(idx)
            items = pd.DataFrame({
                "roa_pos": roa_now > 0,
                "cfo_pos": cfo_n > 0,
                "roa_up": roa_now > roa_prev,
                "accrual": cfo_n > now["IncomeAfterTaxes"].reindex(idx),
                "lev_down": (bn["_lt_debt"] / bn["TotalAssets"]) <= (bp["_lt_debt"] / bp["TotalAssets"]),
                "cr_up": (bn["CurrentAssets"] / bn["CurrentLiabilities"]) > (bp["CurrentAssets"] / bp["CurrentLiabilities"]),
                "no_dilution": bn["OrdinaryShare"] <= bp["OrdinaryShare"] * 1.001,
                "gm_up": (now["GrossProfit"] / now["Revenue"]).reindex(idx) > (prev["GrossProfit"] / prev["Revenue"]).reindex(idx),
                "turn_up": (now["Revenue"].reindex(idx) / bn["TotalAssets"]) > (prev["Revenue"].reindex(idx) / bp["TotalAssets"]),
            })
            complete = (roa_prev.notna() & cfo_n.notna() & bp["TotalAssets"].notna()
                        & (cfo_prev.reindex(idx).notna() if cfo_prev is not None else False))
            out.append(pd.DataFrame({"f_score": items.sum(axis=1).astype(float).where(complete)}))

    rev = pd.concat([store.read_table("revenue"), store.read_table("revenue_latest")], ignore_index=True)
    if not rev.empty:
        rev = rev.drop_duplicates(["code", "year", "month"], keep="last").sort_values(["code", "year", "month"])

        def ttm_yoy(g):
            r = g["revenue"].tolist()
            if len(r) < 24:
                return np.nan
            a, b = sum(r[-12:]), sum(r[-24:-12])
            return (a / b - 1) * 100 if b > 0 else np.nan
        out.append(rev.groupby("code").apply(ttm_yoy, include_groups=False).rename("rev_ttm_yoy").to_frame())

    if not out:
        return pd.DataFrame()
    f = out[0]
    for x in out[1:]:
        f = f.join(x, how="outer")
    return f


def finish(base: pd.DataFrame) -> pd.DataFrame:
    """用市值把進階指標組起來（base 需已有 market_cap、industry 等欄位）。"""
    mc = base["market_cap"] * 1e8
    if "ebit_ttm" in base:
        ev = mc + base.get("_debt", 0).fillna(0) - base.get("_cash", 0).fillna(0)
        base["earnings_yield"] = (base["ebit_ttm"] / ev * 100).where(ev > 0)
        capital = base.get("_nwc", 0).clip(lower=0).fillna(0) + base.get("_ppe", 0).fillna(0)
        base["roc"] = (base["ebit_ttm"] / capital * 100).where(capital > 0)
    if "cfo_ttm" in base:
        base["pcf"] = (mc / base["cfo_ttm"]).where(base["cfo_ttm"] > 0)
    ind = base.get("industry", pd.Series("", index=base.index)).fillna("")
    base["is_financial"] = ind.str.contains("金融|保險|銀行|證券").astype(float)
    base["is_utility"] = ind.str.contains("油電燃氣").astype(float)
    return base.drop(columns=[c for c in ("_debt", "_cash", "_nwc", "_ppe", "ebit_ttm", "cfo_ttm") if c in base])
