"""
個股頁資料：每檔一個檔案 site/stock/{code}.json.gz（約 25–35 KB），網站點進個股才下載。

內容：
- info：名稱、市場、產業、上市日、股本、發行股數
- daily：欄位陣列（日期、開高低收、成交張數、還原因子、外資／投信／自營商買賣超張數、融資／融券餘額）
- revenue：月營收（最近 60 個月）
- quarters：季財報（最近 20 季：營收、EPS、毛利率、營業利益率、淨利率、ROE 年化）
- dividends：股利（普通股用 FinMind 股利資料；ETF 用除息紀錄）
- holders：集保大戶（每週，從上線起累積）
"""
import gzip
import json
import logging
import math
import threading
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pandas as pd

from . import util
from .snapshot import adjust_factors
from .store import DataStore

log = logging.getLogger(__name__)
PREFIX = "site/stock"


def _r(v, nd=2):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return round(f, nd)


def _col(df: pd.DataFrame, name: str, nd=2, scale=1.0):
    if name not in df:
        return [None] * len(df)
    return [_r(v * scale if v is not None else None, nd) for v in df[name].tolist()]


def _pivot(df: pd.DataFrame, types) -> pd.DataFrame:
    sub = df[df["type"].isin(types)]
    if sub.empty:
        return pd.DataFrame(columns=["code", "date", *types])
    p = sub.pivot_table(index=["code", "date"], columns="type", values="value", aggfunc="last").reset_index()
    for t in types:
        if t not in p:
            p[t] = np.nan
    return p.sort_values(["code", "date"])


def load_inputs(store: DataStore, asof: pd.Timestamp, years: float = 4.2) -> dict:
    start = asof - pd.Timedelta(days=int(365.25 * years))
    prices = store.read_daily("prices", start, asof).reset_index(drop=True)
    exr = store.read_daily("exright", start, asof + pd.Timedelta(days=1))
    prices["adj"] = adjust_factors(prices, exr).values
    prices = prices.sort_values(["code", "date"])
    insti = store.read_daily("insti", start, asof)
    margin = store.read_daily("margin", start, asof)
    daily = prices[["date", "code", "open", "high", "low", "close", "volume", "adj"]]
    if not insti.empty:
        daily = daily.merge(insti[["date", "code", "foreign", "trust", "dealer"]], on=["date", "code"], how="left")
    if not margin.empty:
        daily = daily.merge(margin[["date", "code", "margin_balance", "short_balance"]], on=["date", "code"], how="left")

    inc = store.read_table("income")
    q = _pivot(inc, ["Revenue", "GrossProfit", "OperatingIncome", "IncomeAfterTaxes",
                     "EquityAttributableToOwnersOfParent", "EPS"]) if not inc.empty else pd.DataFrame()
    bal = store.read_table("balance")
    if not q.empty and not bal.empty:
        b = _pivot(bal, ["EquityAttributableToOwnersOfParent", "Equity"])
        b["equity"] = b["EquityAttributableToOwnersOfParent"].fillna(b["Equity"])
        q = q.merge(b[["code", "date", "equity"]], on=["code", "date"], how="left")

    rev = pd.concat([store.read_table("revenue"), store.read_table("revenue_latest")], ignore_index=True)
    if not rev.empty:
        rev = rev.drop_duplicates(["code", "year", "month"], keep="last").sort_values(["code", "year", "month"])

    return {
        "daily": daily,
        "quarters": q,
        "revenue": rev,
        "dividend": store.read_table("dividend"),
        "exright": exr,
        "holders": store.read_daily("holders", asof - pd.Timedelta(days=400), asof),
        "securities": store.read_table("securities"),
        "company": store.read_table("company"),
    }


def _groups(df: pd.DataFrame) -> dict:
    if df is None or df.empty or "code" not in df:
        return {}
    return {c: g for c, g in df.groupby("code", sort=False)}


def build_one(code: str, d: pd.DataFrame, parts: dict, info: dict, asof: str) -> dict:
    d = d.sort_values("date")
    out = {
        "code": code, "asof": asof, "info": info,
        "daily": {
            "d": d["date"].dt.strftime("%Y-%m-%d").tolist(),
            "o": _col(d, "open"), "h": _col(d, "high"), "l": _col(d, "low"), "c": _col(d, "close"),
            "v": _col(d, "volume", 0, 1 / 1000),            # 張
            "f": _col(d, "adj", 6),
            "fi": _col(d, "foreign", 0, 1 / 1000), "it": _col(d, "trust", 0, 1 / 1000),
            "dl": _col(d, "dealer", 0, 1 / 1000),
            "mb": _col(d, "margin_balance", 0), "sb": _col(d, "short_balance", 0),
        },
    }
    rv = parts["revenue"].get(code)
    if rv is not None and not rv.empty:
        rv = rv.tail(60)
        out["revenue"] = [[f"{y}-{m:02d}", _r(v, 0)] for y, m, v in zip(rv["year"], rv["month"], rv["revenue"])]
    qq = parts["quarters"].get(code)
    if qq is not None and not qq.empty:
        qq = qq.tail(20)
        rows = []
        for r in qq.itertuples(index=False):
            rev_ = getattr(r, "Revenue", np.nan)
            eq = getattr(r, "equity", np.nan)
            ni_o = getattr(r, "EquityAttributableToOwnersOfParent", np.nan)

            def ratio(x):
                return _r(x / rev_ * 100) if rev_ and rev_ == rev_ and rev_ != 0 else None
            rows.append({
                "p": f"{r.date.year}Q{(r.date.month - 1) // 3 + 1}",
                "rev": _r(rev_, 0), "eps": _r(getattr(r, "EPS", np.nan)),
                "gm": ratio(getattr(r, "GrossProfit", np.nan)), "om": ratio(getattr(r, "OperatingIncome", np.nan)),
                "nm": ratio(getattr(r, "IncomeAfterTaxes", np.nan)),
                "roe": _r(ni_o * 4 / eq * 100) if eq and eq == eq and eq > 0 else None,
            })
        out["quarters"] = rows
    dv = parts["dividend"].get(code)
    if dv is not None and not dv.empty:
        dv = dv.sort_values("date").tail(20)
        out["dividends"] = [{
            "period": str(p), "cash": _r(c, 4), "stock": _r(s, 4),
            "ex": e.strftime("%Y-%m-%d") if isinstance(e, pd.Timestamp) and not pd.isna(e) else None,
        } for p, c, s, e in zip(dv["period"], dv["cash"], dv["stock"], dv["cash_ex_date"])]
    elif info.get("sec_type") == "etf":
        ex = parts["exright"].get(code)
        if ex is not None and not ex.empty:
            ex = ex.sort_values("date").tail(20)
            out["dividends"] = [{"period": dt_.strftime("%Y-%m-%d"), "cash": _r(v, 4), "stock": 0,
                                 "ex": dt_.strftime("%Y-%m-%d")} for dt_, v in zip(ex["date"], ex["value"])]
    hd = parts["holders"].get(code)
    if hd is not None and not hd.empty:
        hd = hd.sort_values("date").tail(52)
        out["holders"] = [{"d": x.strftime("%Y-%m-%d"), "big": _r(b), "big400": _r(b4), "retail": _r(rt),
                           "n": _r(n, 0)} for x, b, b4, rt, n in
                          zip(hd["date"], hd["pct_1000"], hd["pct_400"], hd["pct_retail"], hd["holders"])]
    return out


def build_all(store: DataStore, asof=None, codes: list[str] | None = None, workers: int = 8) -> dict:
    days = store.get_state("days", {})
    if asof is None:
        done = [d for d, s in days.items() if isinstance(s, dict) and s.get("twse_quotes") == "ok"]
        asof = max(done) if done else util.today_tw().isoformat()
    asof = pd.Timestamp(asof)
    inp = load_inputs(store, asof)
    daily = inp["daily"]
    recent = daily[daily["date"] >= asof - pd.Timedelta(days=30)]["code"].unique()
    targets = sorted(set(recent) if codes is None else set(codes) & set(daily["code"].unique()))
    parts = {k: _groups(inp[k]) for k in ("revenue", "quarters", "dividend", "exright", "holders")}
    sec = inp["securities"].set_index("code") if not inp["securities"].empty else pd.DataFrame()
    comp = inp["company"].set_index("code") if not inp["company"].empty else pd.DataFrame()
    prices_name = store.read_daily("prices", asof - pd.Timedelta(days=30), asof)
    names = prices_name.sort_values("date").groupby("code")["name"].last() if "name" in prices_name else {}
    markets = prices_name.sort_values("date").groupby("code")["market"].last() if not prices_name.empty else {}
    by_code = _groups(daily)
    asof_s = asof.strftime("%Y-%m-%d")

    def info_for(code):
        i = {"name": names.get(code, ""), "market": markets.get(code, ""), "sec_type": util.security_type(code)}
        if code in sec.index:
            s = sec.loc[code]
            i["industry"] = s.get("industry") or ""
            i["name"] = i["name"] or s.get("name") or ""
        if code in comp.index:
            c = comp.loc[code]
            ld = c.get("listed_date")
            i["listed"] = ld.strftime("%Y-%m-%d") if isinstance(ld, pd.Timestamp) and not pd.isna(ld) else None
            i["capital"] = _r(c.get("capital"), 0)
            i["shares"] = _r(c.get("shares_issued"), 0)
        return i

    local = threading.local()

    def upload(code):
        st = getattr(local, "st", None)
        if st is None:
            st = local.st = store.st.clone()
        payload = build_one(code, by_code[code], parts, info_for(code), asof_s)
        raw = gzip.compress(json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        st.put(f"{PREFIX}/{code}.json.gz", raw, "application/gzip")
        return len(raw)

    sizes, failed = [], []
    with ThreadPoolExecutor(max_workers=workers) as ex:
        futs = {ex.submit(upload, c): c for c in targets}
        for f, c in futs.items():
            try:
                sizes.append(f.result())
            except Exception as e:  # noqa: BLE001 — 單檔失敗不影響其他檔
                failed.append(c)
                log.warning("個股檔 %s 失敗：%s", c, e)
    res = {"asof": asof_s, "count": len(sizes), "failed": failed[:20], "n_failed": len(failed),
           "avg_kb": round(sum(sizes) / max(len(sizes), 1) / 1024, 1), "total_mb": round(sum(sizes) / 1024 / 1024, 1)}
    log.info("個股檔：%s", res)
    return res
