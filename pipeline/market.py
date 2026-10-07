"""
第 1 批：市場總覽與排行榜的資料任務。
- fetch_extras：某個交易日的補充資料（法人金額、當沖、借券、鉅額、類股指數、融資總額、期貨、櫃買指數）
- backfill_extras：補最近 N 個交易日（讓走勢小圖有歷史）
- build_market：產生網站用的 site/market.json
"""
import datetime as dt
import gzip
import json
import logging

import numpy as np
import pandas as pd

from . import util
from .http import FetchError, Fetcher
from .sources import extras, twse
from .store import DataStore

log = logging.getLogger(__name__)
MARKET_PATH = "site/market.json.gz"


def _put(store: DataStore, name: str, df):
    if df is not None and not df.empty:
        store.upsert_daily(name, df)


def fetch_twse_extras(fetcher: Fetcher, store: DataStore, d: dt.date) -> list[str]:
    """證交所可指定日期的補充資料；回傳失敗的項目。"""
    failed = []
    for name, (url, params) in extras.twse_requests(d).items():
        try:
            body = fetcher.get_json(url, params)
        except FetchError as e:
            log.warning("%s %s 失敗：%s", d, name, e)
            failed.append(name)
            continue
        if name == "insti_amount":
            _put(store, "market_insti", extras.parse_insti_amount(body, d))
        elif name == "daytrade":
            for k, v in extras.parse_daytrade(body, d).items():
                _put(store, k, v)
        elif name == "sbl":
            _put(store, "sbl", extras.parse_sbl(body, d))
        elif name == "block":
            _put(store, "block", extras.parse_block(body, d))
    return failed


def fetch_latest_extras(fetcher: Fetcher, store: DataStore) -> dict:
    """櫃買、期交所的 OpenAPI 只有最新一天；櫃買指數抓本月。"""
    counts = {}

    def safe(name, fn):
        try:
            counts[name] = fn()
        except Exception as e:  # noqa: BLE001 — 單一來源失敗不影響其他
            log.warning("%s 失敗：%s", name, e)
            counts[name] = f"失敗：{e}"[:60]

    def tpex_insti():
        df = extras.parse_tpex_insti_amount(fetcher.get_json(extras.LATEST["tpex_insti_amount"]))
        _put(store, "market_insti", df)
        return len(df)

    def tpex_daytrade():
        df = extras.parse_tpex_daytrade(fetcher.get_json(extras.LATEST["tpex_daytrade"]))
        _put(store, "daytrade_total", df)
        return len(df)

    def tpex_sbl():
        df = extras.parse_tpex_sbl(fetcher.get_json(extras.LATEST["tpex_sbl"]))
        _put(store, "sbl", df)
        return len(df)

    def tpex_block():
        sec = store.read_table("securities")
        names = {str(n).strip(): c for c, n in zip(sec.get("code", []), sec.get("name", []))} if not sec.empty else {}
        df = extras.parse_tpex_block(fetcher.get_json(extras.LATEST["tpex_block"]), names)
        _put(store, "block", df)
        return len(df)

    def futures():
        df = extras.parse_futures(fetcher.get_json(extras.LATEST["futures"], delay=1))
        _put(store, "futures", df)
        return len(df)

    def tpex_index():
        url, params = extras.tpex_index_request(util.today_tw())
        df = extras.parse_tpex_index(fetcher.get_json(url, params))
        _put(store, "indices", df)
        return len(df)

    def dca_rank():
        data = extras.parse_dca_rank(fetcher.get_json(extras.LATEST["dca_rank"]))
        if data["stocks"] or data["etfs"]:
            store.put_state("dca_rank", {**data, "fetched": util.today_tw().isoformat()})
        return len(data["stocks"]) + len(data["etfs"])

    def taiex_ohlc():
        url, params = twse.taiex_ohlc_request(util.today_tw())
        df = twse.parse_taiex_ohlc(fetcher.get_json(url, params))
        _put(store, "taiex_ohlc", df)
        return len(df)

    def sentiment(name, parser):
        def fn():
            df = parser(fetcher.get_json(extras.LATEST[name], delay=1))
            _put(store, name, df)
            return len(df)
        return fn

    def business_light():
        meta = fetcher.get_json(extras.NDC_DATASET, delay=1)
        url = meta["result"]["distribution"][0]["resourceDownloadUrl"]
        r = fetcher.session.get(url, timeout=60)
        r.raise_for_status()
        rows = extras.parse_business_light(r.content)
        if rows:
            store.put_state("business_light", {"latest": rows[-1], "series": rows[-24:], "fetched": util.today_tw().isoformat(),
                                               "source": "國家發展委員會（政府資料開放平臺）"})
        return len(rows)

    safe("business_light", business_light)
    for name, parser in (("pcr", extras.parse_pcr), ("fut_large", extras.parse_fut_large),
                         ("fut_insti", extras.parse_fut_insti), ("fx", extras.parse_fx)):
        safe(name, sentiment(name, parser))
    for name, fn in (("taiex_ohlc", taiex_ohlc), ("dca_rank", dca_rank), ("tpex_insti", tpex_insti), ("tpex_daytrade", tpex_daytrade), ("tpex_sbl", tpex_sbl),
                     ("tpex_block", tpex_block), ("futures", futures), ("tpex_index", tpex_index)):
        safe(name, fn)
    return counts


def run_extras(store: DataStore, fetcher: Fetcher, trading_days: list[dt.date]) -> dict:
    """每日任務呼叫：對已完成、還沒抓過補充資料的交易日補抓。"""
    st = store.get_state("extras", {"done": []})
    done = set(st["done"])
    n = 0
    for d in sorted(trading_days):
        if d.isoformat() in done:
            continue
        if not fetch_twse_extras(fetcher, store, d):
            done.add(d.isoformat())
            n += 1
    st["done"] = sorted(done)[-400:]
    store.put_state("extras", st)
    counts = fetch_latest_extras(fetcher, store)
    counts["twse_extra_days"] = n
    return counts


def backfill_extras(store: DataStore, fetcher: Fetcher, days: int = 70) -> int:
    """補最近 N 個交易日的類股指數、融資總額與證交所補充資料，以及最近幾個月的櫃買指數。"""
    state = store.get_state("days", {})
    trading = sorted(dt.date.fromisoformat(k) for k, v in state.items()
                     if isinstance(v, dict) and v.get("twse_quotes") == "ok")[-days:]
    for d in trading:
        try:
            url, params = extras.indices_request(d)
            _put(store, "indices", twse.parse_indices(fetcher.get_json(url, params), d))
            url, params = extras.margin_request(d)
            _put(store, "margin_total", twse.parse_margin(fetcher.get_json(url, params), d).get("margin_total"))
        except FetchError as e:
            log.warning("%s 指數／融資總額失敗：%s", d, e)
    if trading:
        m = dt.date(trading[0].year, trading[0].month, 1)
        while m <= util.today_tw():
            try:
                url, params = extras.tpex_index_request(m)
                _put(store, "indices", extras.parse_tpex_index(fetcher.get_json(url, params)))
            except FetchError as e:
                log.warning("櫃買指數 %s 失敗：%s", m, e)
            m = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    run_extras(store, fetcher, trading)
    return len(trading)


def backfill_indices(store: DataStore, fetcher: Fetcher, years: float = 4, budget_min: float = 320) -> tuple[int, int]:
    """指數歷史：證交所各類股指數（每個交易日一次）、加權指數開高低收與櫃買指數（每月一次）。可續跑。"""
    import time
    t0 = time.monotonic()
    st = store.get_state("indices_hist", {"days": [], "months": []})
    done_d, done_m = set(st["days"]), set(st["months"])
    today = util.today_tw()
    start = today - dt.timedelta(days=int(365.25 * years))
    state = store.get_state("days", {})
    trading = sorted(dt.date.fromisoformat(k) for k, v in state.items()
                     if isinstance(v, dict) and v.get("twse_quotes") == "ok" and dt.date.fromisoformat(k) >= start)
    # 每月：加權 OHLC、櫃買指數（本月與上月每次都重抓）
    m = dt.date(start.year, start.month, 1)
    recent = (today.replace(day=1) - dt.timedelta(days=1)).replace(day=1)
    while m <= today:
        key = m.strftime("%Y-%m")
        if key not in done_m or m >= recent:
            try:
                url, params = twse.taiex_ohlc_request(m)
                _put(store, "taiex_ohlc", twse.parse_taiex_ohlc(fetcher.get_json(url, params)))
                url, params = extras.tpex_index_request(m)
                _put(store, "indices", extras.parse_tpex_index(fetcher.get_json(url, params)))
                done_m.add(key)
            except FetchError as e:
                log.warning("指數月資料 %s 失敗：%s", key, e)
        m = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
    # 每日：類股指數
    have = store.read_daily("indices", start, today)
    have_days = set(have[have["market"] == "TWSE"]["date"].dt.date) if not have.empty else set()
    todo = [d for d in reversed(trading) if d.isoformat() not in done_d and d not in have_days]
    buf, n = [], 0
    for d in todo:
        if (time.monotonic() - t0) / 60 > budget_min:
            break
        try:
            url, params = extras.indices_request(d)
            df = twse.parse_indices(fetcher.get_json(url, params), d)
            if not df.empty:
                buf.append(df)
            done_d.add(d.isoformat())
            n += 1
        except FetchError as e:
            log.warning("%s 類股指數失敗：%s", d, e)
        if len(buf) >= 40:
            store.upsert_daily("indices", pd.concat(buf, ignore_index=True))
            buf = []
            store.put_state("indices_hist", {"days": sorted(done_d), "months": sorted(done_m)})
    if buf:
        store.upsert_daily("indices", pd.concat(buf, ignore_index=True))
    store.put_state("indices_hist", {"days": sorted(done_d), "months": sorted(done_m)})
    left = len(todo) - n
    log.info("指數回補：本次 %d 天，剩 %d 天", n, left)
    return len(todo), left


INDICES_PATH = "site/indices.json.gz"


def build_indices(store: DataStore, asof=None) -> dict:
    """指數詳細頁用：每個指數 4 年收盤（加權指數含開高低收）、台指期近月（一般／盤後）。"""
    days = store.get_state("days", {})
    if asof is None:
        done = [d for d, s in days.items() if isinstance(s, dict) and s.get("twse_quotes") == "ok"]
        asof = max(done)
    asof = pd.Timestamp(asof)
    start = asof - pd.Timedelta(days=int(365.25 * 4) + 10)
    out: dict = {"asof": asof.strftime("%Y-%m-%d"), "series": {}}
    ind = store.read_daily("indices", start, asof)
    if not ind.empty:
        ind = ind.sort_values("date")
        for (name, mkt), g in ind.groupby(["name", "market"], sort=False):
            g = g.dropna(subset=["close"])
            if len(g) < 5:
                continue
            out["series"][name] = {"market": mkt, "d": g["date"].dt.strftime("%Y-%m-%d").tolist(),
                                   "c": [_num(x) for x in g["close"]]}
    oh = store.read_daily("taiex_ohlc", start, asof)
    name = "發行量加權股價指數"
    if not oh.empty:
        oh = oh.sort_values("date").dropna(subset=["close"])
        out["series"].setdefault(name, {"market": "TWSE"}).update({"d": oh["date"].dt.strftime("%Y-%m-%d").tolist(), "o": [_num(x) for x in oh["open"]],
                                    "h": [_num(x) for x in oh["high"]], "l": [_num(x) for x in oh["low"]],
                                    "c": [_num(x) for x in oh["close"]]})
    fut = store.read_daily("futures", start, asof + pd.Timedelta(days=3))
    for session, label in (("一般", "台指期"), ("盤後", "台指期盤後")):
        g = fut[fut["session"] == session].sort_values("date") if not fut.empty else fut
        if g is not None and not g.empty:
            out["series"][label] = {"market": "TAIFEX", "d": g["date"].dt.strftime("%Y-%m-%d").tolist(),
                                    "c": [_num(x) for x in g["close"]]}
    return out


def write_indices(store: DataStore, data: dict) -> int:
    raw = gzip.compress(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    store.st.put(INDICES_PATH, raw, "application/gzip")
    return len(raw)


# ---------------- 市場總覽檔 ----------------

KEY_INDICES = [
    ("加權指數", "發行量加權股價指數"), ("櫃買指數", "櫃買指數"), ("半導體類", "半導體類指數"),
    ("電子工業類", "電子工業類指數"), ("金融保險類", "金融保險類指數"), ("電腦及週邊設備類", "電腦及週邊設備類指數"),
    ("光電類", "光電類指數"), ("通信網路類", "通信網路類指數"),
]


def _num(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if np.isnan(f) or np.isinf(f) else round(f, 4)


def build_market(store: DataStore, asof=None) -> dict:
    days = store.get_state("days", {})
    if asof is None:
        done = [d for d, s in days.items() if isinstance(s, dict) and s.get("twse_quotes") == "ok"]
        asof = max(done)
    asof = pd.Timestamp(asof)
    start = asof - pd.Timedelta(days=120)
    out: dict = {"asof": asof.strftime("%Y-%m-%d"), "generated_at": util.now_tw().isoformat(timespec="seconds")}

    # 指數：最新值＋近 60 日收盤（走勢小圖）
    ind = store.read_daily("indices", start, asof)
    cards = []
    if not ind.empty:
        for label, name in KEY_INDICES:
            s = ind[ind["name"] == name].sort_values("date")
            if s.empty:
                continue
            last = s.iloc[-1]
            cards.append({"label": label, "name": name, "date": last["date"].strftime("%Y-%m-%d"), "close": _num(last["close"]),
                          "chg": _num(last["chg"]), "chg_pct": _num(last["chg_pct"]),
                          "spark": [_num(x) for x in s["close"].tail(60)]})
    fut = store.read_daily("futures", start, asof + pd.Timedelta(days=3))
    for session in ("一般", "盤後"):
        s = fut[fut["session"] == session].sort_values("date") if not fut.empty else fut
        if s is not None and not s.empty:
            last = s.iloc[-1]
            cards.insert(1 if session == "一般" else 2, {
                "label": "台指期" if session == "一般" else "台指期盤後",
                "name": "台指期" if session == "一般" else "台指期盤後", "date": last["date"].strftime("%Y-%m-%d"),
                "close": _num(last["close"]), "chg": _num(last["chg"]), "chg_pct": _num(last["chg_pct"]),
                "spark": [_num(x) for x in s["close"].tail(60)]})
    out["indices"] = cards

    # 漲跌家數、成交量值（股票＋ETF，上市＋上櫃）
    px = store.read_daily("prices", asof - pd.Timedelta(days=45), asof)
    if not px.empty:
        px = px.sort_values(["code", "date"])
        px["chg"] = px.groupby("code")["close"].diff()
        today = px[px["date"] == asof]
        breadth = {}
        for mkt, g in (("all", today), ("TWSE", today[today["market"] == "TWSE"]), ("TPEX", today[today["market"] == "TPEX"])):
            breadth[mkt] = {"up": int((g["chg"] > 0).sum()), "flat": int((g["chg"] == 0).sum()), "down": int((g["chg"] < 0).sum())}
        out["breadth"] = breadth
        daily = px.groupby("date").agg(value=("value", "sum"), volume=("volume", "sum")).sort_index()
        last = daily.iloc[-1]
        avg20 = daily["value"].iloc[-21:-1].mean() if len(daily) > 1 else np.nan
        out["turnover"] = {"value": _num(last["value"]), "volume": _num(last["volume"]),
                           "value_ratio": _num(last["value"] / avg20) if avg20 else None,
                           "series": [_num(x) for x in daily["value"].tail(20)]}

    # 三大法人買賣金額（上市＋上櫃）
    mi = store.read_daily("market_insti", asof - pd.Timedelta(days=45), asof)
    if not mi.empty:
        g = mi.groupby("date")[["foreign", "trust", "dealer", "total"]].sum(min_count=1).sort_index()
        last = g.iloc[-1]
        out["insti"] = {"date": g.index[-1].strftime("%Y-%m-%d"),
                        **{k: _num(last[k]) for k in ("foreign", "trust", "dealer", "total")},
                        "series": [{"date": d.strftime("%m/%d"), "total": _num(r["total"])} for d, r in g.tail(20).iterrows()],
                        "markets": sorted(mi[mi["date"] == g.index[-1]]["market"].unique().tolist())}

    # 融資融券（上市）
    mt = store.read_daily("margin_total", asof - pd.Timedelta(days=45), asof)
    if not mt.empty:
        t = mt.sort_values("date").iloc[-1]
        out["margin"] = {"date": t["date"].strftime("%Y-%m-%d"), "margin_amount": _num(t.get("margin_amount")),
                         "margin_amount_prev": _num(t.get("margin_amount_prev")), "short_lots": _num(t.get("short_lots")),
                         "short_lots_prev": _num(t.get("short_lots_prev")),
                         "series": [_num(x) for x in mt.sort_values("date")["margin_amount"].tail(20)]}

    # 當沖比重
    dtt = store.read_daily("daytrade_total", asof - pd.Timedelta(days=10), asof)
    if not dtt.empty:
        last = dtt[dtt["date"] == dtt["date"].max()]
        out["daytrade"] = {"date": dtt["date"].max().strftime("%Y-%m-%d"),
                           **{m: _num(last[last["market"] == m]["volume_ratio"].iloc[0]) for m in last["market"]}}

    # 三大法人近 5 日產業資金（估算：買賣超股數 × 收盤價）
    it = store.read_daily("insti", asof - pd.Timedelta(days=12), asof)
    sec = store.read_table("securities")
    if not it.empty and not px.empty and not sec.empty:
        last5 = sorted(it["date"].unique())[-5:]
        it = it[it["date"].isin(last5)].merge(px[["date", "code", "close"]], on=["date", "code"], how="left")
        it["amt"] = it["total"] * it["close"]
        it = it.merge(sec[["code", "industry", "sec_type"]], on="code", how="left")
        comp = store.read_table("company")
        icode = comp.set_index("code")["industry_code"] if not comp.empty and "industry_code" in comp else pd.Series(dtype=object)
        it["industry"] = [util.main_industry(icode.get(c), raw) for c, raw in zip(it["code"], it["industry"])]
        it = it[(it["sec_type"] == "stock") & it["industry"].notna()]
        g = it.groupby("industry")["amt"].sum().sort_values()
        out["industry_flow"] = {"days": len(last5), "items": [{"industry": k, "amount": _num(v)} for k, v in g.items()]}

    # 定期定額交易戶數排行（證交所每月公布）
    dca = store.get_state("dca_rank", {})
    if dca.get("stocks") or dca.get("etfs"):
        out["dca"] = dca
    try:
        out["sentiment"] = sentiment(store, asof)
    except Exception as e:  # noqa: BLE001 — 情緒指標失敗不影響其他區塊
        log.warning("市場情緒失敗：%s", e)
    return out


# ---------------- 市場情緒 ----------------

def _pctile(series: pd.Series, value) -> float | None:
    s = series.dropna()
    if len(s) < 60 or value is None or pd.isna(value):
        return None
    return float((s < value).mean() * 100)


def _clamp(x):
    return None if x is None else max(0.0, min(100.0, float(x)))


def sentiment(store: DataStore, asof: pd.Timestamp) -> dict:
    """
    本站自算的「恐懼與貪婪指數」（0＝極度恐懼、100＝極度貪婪），各項分數取平均：
      大盤動能：加權指數相對 125 日均線（近兩年百分位）
      市場波動：加權指數 20 日年化波動（越高越恐懼，反向百分位）
      上漲家數：近 10 日平均上漲家數比例（近一年百分位）
      融資水位：上市融資餘額 20 日變化（近一年百分位）
      選擇權 Put/Call 比（未平倉）：140% 以上＝0 分、70% 以下＝100 分（線性）
    另附：期貨大額交易人、三大法人台指期未平倉、美元兌新台幣。
    """
    out: dict = {}
    comps = []
    idx = store.read_daily("index", asof - pd.Timedelta(days=1100), asof).sort_values("date")
    if not idx.empty and "taiex" in idx:
        t = idx.set_index("date")["taiex"].dropna()
        mom = (t / t.rolling(125).mean() - 1) * 100
        vol = t.pct_change().rolling(20).std() * np.sqrt(252) * 100
        m, v = mom.iloc[-1], vol.iloc[-1]
        comps.append({"key": "momentum", "label": "大盤動能", "value": _num(m), "unit": "% 相對 125 日均線",
                      "score": _clamp(_pctile(mom.tail(500), m))})
        p = _pctile(vol.tail(500), v)
        comps.append({"key": "volatility", "label": "市場波動", "value": _num(v), "unit": "% 年化波動",
                      "score": _clamp(None if p is None else 100 - p)})
    px = store.read_daily("prices", asof - pd.Timedelta(days=400), asof)
    if not px.empty:
        px = px[px["code"].map(util.security_type) == "stock"].sort_values(["code", "date"])
        px["up"] = px.groupby("code")["close"].diff() > 0
        px["has"] = px.groupby("code")["close"].diff().notna()
        daily = px.groupby("date").apply(lambda g: g["up"].sum() / max(g["has"].sum(), 1) * 100, include_groups=False)
        up10 = daily.rolling(10).mean()
        comps.append({"key": "breadth", "label": "上漲家數", "value": _num(up10.iloc[-1]), "unit": "% 近 10 日平均上漲比例",
                      "score": _clamp(_pctile(up10, up10.iloc[-1]))})
    mt = store.read_daily("margin_total", asof - pd.Timedelta(days=400), asof)
    if not mt.empty and "margin_amount" in mt:
        s = mt[mt.get("market", "TWSE") == "TWSE"] if "market" in mt else mt
        s = s.sort_values("date").set_index("date")["margin_amount"].dropna()
        ch = (s / s.shift(20) - 1) * 100
        if ch.notna().any():
            comps.append({"key": "margin", "label": "融資水位", "value": _num(ch.iloc[-1]), "unit": "% 融資餘額 20 日變化",
                          "score": _clamp(_pctile(ch, ch.iloc[-1]))})
    pcr = store.read_daily("pcr", asof - pd.Timedelta(days=400), asof).sort_values("date")
    if not pcr.empty:
        last = pcr.iloc[-1]
        x = last["pcr_oi"]
        comps.append({"key": "pcr", "label": "選擇權 Put/Call 比", "value": _num(x), "unit": "% 未平倉",
                      "score": _clamp(None if pd.isna(x) else (140 - x) / 70 * 100)})
        out["pcr"] = {"date": last["date"].strftime("%Y-%m-%d"), "oi": _num(x), "vol": _num(last["pcr_vol"]),
                      "series": [_num(v) for v in pcr["pcr_oi"].tail(60)]}
    scored = [c for c in comps if c["score"] is not None]
    if scored:
        score = sum(c["score"] for c in scored) / len(scored)
        label = "極度恐懼" if score < 25 else "恐懼" if score < 45 else "中性" if score <= 55 else "貪婪" if score <= 75 else "極度貪婪"
        out["fear_greed"] = {"score": round(score, 1), "label": label, "components": comps}
    fl = store.read_daily("fut_large", asof - pd.Timedelta(days=400), asof).sort_values("date")
    if not fl.empty:
        last = fl.iloc[-1]
        out["fut_large"] = {"date": last["date"].strftime("%Y-%m-%d"), **{k: _num(last.get(k)) for k in ("top5_net", "top10_net", "top10_net_inst", "oi")},
                            "series": [_num(v) for v in fl["top10_net"].tail(60)]}
    fi = store.read_daily("fut_insti", asof - pd.Timedelta(days=400), asof).sort_values("date")
    if not fi.empty:
        last = fi.iloc[-1]
        out["fut_insti"] = {"date": last["date"].strftime("%Y-%m-%d"), **{k: _num(last.get(k)) for k in ("foreign_oi_net", "trust_oi_net", "dealer_oi_net")},
                            "series": [_num(v) for v in fi["foreign_oi_net"].tail(60)]}
    fx = store.read_daily("fx", asof - pd.Timedelta(days=400), asof).sort_values("date")
    if not fx.empty:
        s = fx.set_index("date")["usd_twd"].dropna()
        out["fx"] = {"date": s.index[-1].strftime("%Y-%m-%d"), "usd_twd": _num(s.iloc[-1]),
                     "chg20": _num((s.iloc[-1] / s.iloc[max(0, len(s) - 21)] - 1) * 100) if len(s) > 1 else None,
                     "series": [_num(v) for v in s.tail(60)]}
    biz = store.get_state("business_light", {})
    if biz.get("latest"):
        out["business_light"] = biz
    return out


def write_market(store: DataStore, data: dict) -> int:
    raw = gzip.compress(json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
    store.st.put(MARKET_PATH, raw, "application/gzip")
    return len(raw)
