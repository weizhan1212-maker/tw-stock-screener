"""
PoC：驗證台股資料源能否在 GitHub Actions 上抓取，並量測資料大小。

用法：
    python poc/poc.py full      # 完整檢查：證交所、櫃買、FinMind、頻率測試、資料大小估算
    python poc/poc.py publish   # 公布時間探測：檢查「今天」的盤後資料是否已公布（排程在交易日多個時間點執行）

結果寫入 poc/results/。
"""
import datetime as dt
import gzip
import json
import os
import random
import struct
import sys
import time

import requests

TW = dt.timezone(dt.timedelta(hours=8))
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
os.makedirs(OUT, exist_ok=True)

SESSION = requests.Session()
SESSION.headers.update({
    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) tw-stock-screener-poc/0.1",
    "Accept": "application/json, text/plain, */*",
})

POLITE_DELAY = 3.0  # 每次請求間隔秒數，避免被證交所/櫃買封鎖
FINMIND = "https://api.finmindtrade.com/api/v4/data"
FINMIND_TOKEN = os.environ.get("FINMIND_TOKEN", "").strip()


# ---------- 共用工具 ----------

def now_tw():
    return dt.datetime.now(TW)


def roc(d, sep="/"):
    """西元日期轉民國日期字串，例如 2022-01-03 -> 111/01/03"""
    return f"{d.year - 1911}{sep}{d:%m}{sep}{d:%d}"


def get(url, params=None, timeout=40):
    """發出 GET 請求，回傳紀錄（狀態碼、大小、耗時、JSON 或文字開頭）"""
    t0 = time.time()
    rec = {"url": url, "params": params}
    try:
        r = SESSION.get(url, params=params, timeout=timeout)
        rec.update(status=r.status_code, bytes=len(r.content),
                   secs=round(time.time() - t0, 2),
                   ctype=r.headers.get("content-type", ""))
        try:
            rec["_json"] = r.json()
        except Exception:
            rec["text_head"] = r.text[:200]
    except Exception as e:  # 網路錯誤、逾時
        rec.update(status=None, error=repr(e)[:300], secs=round(time.time() - t0, 2))
    return rec


def summarize(rec, keep_sample=True):
    """把各種格式的回應整理成：筆數、欄位、範例列"""
    j = rec.pop("_json", None)
    if j is None:
        return rec
    if isinstance(j, list):
        rec["rows"] = len(j)
        if j and isinstance(j[0], dict):
            rec["fields"] = list(j[0].keys())
        if j and keep_sample:
            rec["sample"] = j[0]
        return rec
    if isinstance(j, dict):
        for k in ("stat", "status", "msg", "date", "title", "reportDate", "iTotalRecords"):
            if k in j and not isinstance(j[k], (list, dict)):
                rec[k] = j[k]
        if isinstance(j.get("tables"), list):
            rec["tables"] = [{
                "title": t.get("title"),
                "rows": len(t.get("data") or []),
                "fields": t.get("fields"),
                "sample": (t.get("data") or [None])[0] if keep_sample else None,
            } for t in j["tables"]]
            rec["rows"] = max([x["rows"] for x in rec["tables"]] or [0])
        for key in ("data", "aaData"):
            if isinstance(j.get(key), list):
                rec["rows"] = len(j[key])
                if j[key]:
                    first = j[key][0]
                    if isinstance(first, dict):
                        rec["fields"] = list(first.keys())
                    if keep_sample:
                        rec["sample"] = first
        if "fields" in j:
            rec["fields"] = j["fields"]
    return rec


def ok(rec):
    return rec.get("status") == 200 and (rec.get("rows") or 0) > 0


def save(name, obj):
    path = os.path.join(OUT, name)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2, default=str)
    return path


# ---------- 端點清單 ----------

def twse_daily_endpoints(d):
    ymd = d.strftime("%Y%m%d")
    base = "https://www.twse.com.tw/rwd/zh"
    return {
        "twse_行情_MI_INDEX": (f"{base}/afterTrading/MI_INDEX", {"date": ymd, "type": "ALLBUT0999", "response": "json"}),
        "twse_法人_T86": (f"{base}/fund/T86", {"date": ymd, "selectType": "ALLBUT0999", "response": "json"}),
        "twse_融資融券_MI_MARGN": (f"{base}/marginTrading/MI_MARGN", {"date": ymd, "selectType": "ALL", "response": "json"}),
        "twse_本益比_BWIBBU_d": (f"{base}/afterTrading/BWIBBU_d", {"date": ymd, "selectType": "ALL", "response": "json"}),
        "twse_外資持股_MI_QFIIS": (f"{base}/fund/MI_QFIIS", {"date": ymd, "selectType": "ALLBUT0999", "response": "json"}),
    }


def tpex_daily_endpoints(d):
    """櫃買中心：新版網站與舊版網站各試一次，看哪個能用"""
    slash = d.strftime("%Y/%m/%d")
    r = roc(d)
    return {
        "tpex_行情_新": ("https://www.tpex.org.tw/www/zh-tw/afterTrading/dailyQuotes", {"date": slash, "response": "json"}),
        "tpex_行情_舊": ("https://www.tpex.org.tw/web/stock/aftertrading/daily_close_quotes/stk_quote_result.php", {"l": "zh-tw", "d": r, "o": "json"}),
        "tpex_法人_新": ("https://www.tpex.org.tw/www/zh-tw/insti/dailyTrade", {"type": "Daily", "sect": "EW", "date": slash, "response": "json"}),
        "tpex_法人_舊": ("https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php", {"l": "zh-tw", "se": "EW", "t": "D", "d": r, "o": "json"}),
        "tpex_融資融券_新": ("https://www.tpex.org.tw/www/zh-tw/margin/balance", {"date": slash, "response": "json"}),
        "tpex_融資融券_舊": ("https://www.tpex.org.tw/web/stock/margin_trading/margin_balance/margin_bal_result.php", {"l": "zh-tw", "o": "json", "d": r}),
        "tpex_本益比_新": ("https://www.tpex.org.tw/www/zh-tw/afterTrading/peQryDate", {"date": slash, "response": "json"}),
        "tpex_本益比_舊": ("https://www.tpex.org.tw/web/stock/aftertrading/peratio_analysis/pera_result.php", {"l": "zh-tw", "o": "json", "d": r}),
    }


TWSE_OPENAPI = {
    "twse_openapi_日行情_STOCK_DAY_ALL": "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
    "twse_openapi_本益比_BWIBBU_ALL": "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_ALL",
    "twse_openapi_月營收_t187ap05_L": "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
    "twse_openapi_損益表_t187ap06_L_ci": "https://openapi.twse.com.tw/v1/opendata/t187ap06_L_ci",
    "twse_openapi_資產負債_t187ap07_L_ci": "https://openapi.twse.com.tw/v1/opendata/t187ap07_L_ci",
    "twse_openapi_公司基本資料_t187ap03_L": "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
    "twse_openapi_休市日_holidaySchedule": "https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule",
}

TPEX_OPENAPI_KEYWORDS = ("daily_close_quotes", "peratio", "3insti", "margin", "t187ap05", "t187ap06", "t187ap07", "t187ap03")


def find_last_trading_day(start):
    """從 start 往前找最近一個有行情資料的交易日"""
    d = start
    for _ in range(12):
        if d.weekday() < 5:
            url, params = twse_daily_endpoints(d)["twse_行情_MI_INDEX"]
            rec = summarize(get(url, params), keep_sample=False)
            time.sleep(POLITE_DELAY)
            if rec.get("stat") == "OK" and (rec.get("rows") or 0) > 0:
                return d
        d -= dt.timedelta(days=1)
    return None


# ---------- 完整檢查 ----------

def run_full():
    report = {"started_at": now_tw().isoformat(), "finmind_token": bool(FINMIND_TOKEN)}
    today = now_tw().date()
    last = find_last_trading_day(today)
    hist = dt.date(2022, 1, 3)
    report["last_trading_day"] = str(last)
    report["history_probe_day"] = str(hist)
    print("最近交易日:", last)

    # 1) 證交所：最近交易日 + 2022 歷史日
    twse = {}
    for label, d in (("latest", last), ("history_2022", hist)):
        if d is None:
            continue
        for name, (url, params) in twse_daily_endpoints(d).items():
            twse[f"{name}@{label}"] = summarize(get(url, params))
            time.sleep(POLITE_DELAY)
    for name, url in TWSE_OPENAPI.items():
        twse[name] = summarize(get(url))
        time.sleep(1)
    # 除權息結果（還原股價用）
    twse["twse_除權息_TWT49U@2022"] = summarize(get(
        "https://www.twse.com.tw/rwd/zh/exRight/TWT49U",
        {"startDate": "20220101", "endDate": "20221231", "response": "json"}))
    report["twse"] = twse

    # 2) 櫃買中心：新舊網站 × 最近交易日 + 歷史日；OpenAPI 從 swagger 找路徑
    tpex = {}
    for label, d in (("latest", last), ("history_2022", hist)):
        if d is None:
            continue
        for name, (url, params) in tpex_daily_endpoints(d).items():
            tpex[f"{name}@{label}"] = summarize(get(url, params))
            time.sleep(POLITE_DELAY)
    sw = get("https://www.tpex.org.tw/openapi/swagger.json")
    sw_json = sw.pop("_json", None)
    tpex["openapi_swagger"] = {k: v for k, v in sw.items() if k != "text_head"} | {"text_head": sw.get("text_head")}
    paths = sorted((sw_json or {}).get("paths", {}).keys()) if isinstance(sw_json, dict) else []
    tpex["openapi_all_paths"] = paths
    picked = [p for p in paths if any(k in p for k in TPEX_OPENAPI_KEYWORDS)][:14]
    for p in picked:
        tpex[f"tpex_openapi{p}"] = summarize(get("https://www.tpex.org.tw/openapi/v1" + p))
        time.sleep(1)
    report["tpex"] = tpex

    # 3) 請求頻率測試：連續 12 個歷史交易日，每 3 秒一次，看會不會被擋
    probe = []
    d = hist + dt.timedelta(days=1)
    while len(probe) < 12:
        if d.weekday() < 5:
            url, params = twse_daily_endpoints(d)["twse_行情_MI_INDEX"]
            r = summarize(get(url, params), keep_sample=False)
            probe.append({"date": str(d), "status": r.get("status"), "stat": r.get("stat"),
                          "rows": r.get("rows"), "secs": r.get("secs"), "error": r.get("error")})
            time.sleep(POLITE_DELAY)
        d += dt.timedelta(days=1)
    report["twse_rate_probe_3s"] = probe

    # 4) FinMind（免費版：一次一檔）
    fm = {}
    start4y = (today - dt.timedelta(days=365 * 4 + 1)).isoformat()
    start8y = (today - dt.timedelta(days=365 * 8 + 2)).isoformat()
    datasets = [
        ("TaiwanStockInfo", None, None),
        ("TaiwanStockDelisting", None, None),
        ("TaiwanStockPrice", "2330", start4y),
        ("TaiwanStockPriceAdj", "2330", start4y),
        ("TaiwanStockFinancialStatements", "2330", start8y),
        ("TaiwanStockBalanceSheet", "2330", start8y),
        ("TaiwanStockCashFlowsStatement", "2330", start8y),
        ("TaiwanStockMonthRevenue", "2330", start8y),
        ("TaiwanStockDividend", "2330", start8y),
    ]
    price_rows = []
    for ds, sid, start in datasets:
        params = {"dataset": ds}
        if sid:
            params["data_id"] = sid
        if start:
            params["start_date"] = start
        if FINMIND_TOKEN:
            params["token"] = FINMIND_TOKEN
        raw = get(FINMIND, params, timeout=90)
        j = raw.get("_json")
        if ds == "TaiwanStockPrice" and isinstance(j, dict):
            price_rows = j.get("data") or []
        rec = summarize(raw)
        rec["params"] = {k: v for k, v in params.items() if k != "token"}
        if isinstance(j, dict) and isinstance(j.get("data"), list) and j["data"] and isinstance(j["data"][0], dict):
            dates = [x.get("date") for x in j["data"] if x.get("date")]
            if dates:
                rec["date_range"] = [min(dates), max(dates)]
            if "type" in j["data"][0]:
                rec["distinct_types"] = len({x.get("type") for x in j["data"]})
        fm[ds] = rec
        time.sleep(1.5)
    report["finmind"] = fm

    # 5) 資料大小估算（以真實檔數計算）
    n_twse = (twse.get(f"twse_行情_MI_INDEX@latest") or {}).get("rows") or 0
    n_tpex = max([(tpex.get(k) or {}).get("rows") or 0 for k in ("tpex_行情_新@latest", "tpex_行情_舊@latest")] or [0])
    report["sizes"] = size_estimates(n_twse, n_tpex, price_rows)

    report["finished_at"] = now_tw().isoformat()
    save("poc_full.json", report)
    write_summary(report)
    print("完成")


def size_estimates(n_twse, n_tpex, price_rows):
    rnd = random.Random(42)
    n = (n_twse + n_tpex) or 2200
    res = {"symbols_twse_rows": n_twse, "symbols_tpex_rows": n_tpex, "symbols_used": n}

    # 最新快照：每檔約 80 個數值指標
    snap = [{"id": f"{1000 + i}", "v": [round(rnd.uniform(-50, 800), 2) for _ in range(80)]} for i in range(n)]
    raw = json.dumps(snap, separators=(",", ":")).encode()
    res["snapshot_raw_kb"] = round(len(raw) / 1024)
    res["snapshot_gz_kb"] = round(len(gzip.compress(raw)) / 1024)

    # 個股歷史：用 2330 真實 4 年日線 + 模擬法人/融資欄位
    days = len(price_rows) or 980
    res["trading_days_4y"] = days
    if price_rows:
        cols = {k: [r.get(k) for r in price_rows] for k in ("date", "open", "max", "min", "close", "Trading_Volume")}
    else:
        cols = {"close": [round(rnd.uniform(100, 1000), 1) for _ in range(days)]}
    for k in ("foreign", "trust", "dealer", "margin", "short"):
        cols[k] = [rnd.randint(-20000, 20000) for _ in range(days)]
    hraw = json.dumps(cols, separators=(",", ":")).encode()
    per_gz = len(gzip.compress(hraw))
    res["per_stock_history_raw_kb"] = round(len(hraw) / 1024, 1)
    res["per_stock_history_gz_kb"] = round(per_gz / 1024, 1)
    res["all_stock_history_gz_mb"] = round(per_gz * n / 1024 / 1024, 1)

    # 每日還原價矩陣（float32），以隨機漫步模擬，壓縮率接近真實
    buf = bytearray()
    for _ in range(n):
        p = rnd.uniform(10, 500)
        for _ in range(days):
            p *= 1 + rnd.gauss(0, 0.02)
            buf += struct.pack("<f", p)
    res["price_matrix_raw_mb"] = round(len(buf) / 1024 / 1024, 2)
    res["price_matrix_gz_mb"] = round(len(gzip.compress(bytes(buf))) / 1024 / 1024, 2)
    res["price_matrix_per_year_gz_mb"] = round(res["price_matrix_gz_mb"] / 4, 2)

    # 月底指標快照：每個指標 48 個月 × n 檔（float32）
    res["factor_file_raw_kb"] = round(48 * n * 4 / 1024)
    return res


def write_summary(r):
    lines = [f"# PoC 結果摘要", "", f"- 執行時間：{r['started_at']}", f"- 最近交易日：{r['last_trading_day']}",
             f"- FinMind token：{'有' if r['finmind_token'] else '無（每小時 300 次）'}", "", "## 端點結果", "",
             "| 名稱 | HTTP | 筆數 | 大小(KB) | 秒 | 備註 |", "|---|---|---|---|---|---|"]
    for group in ("twse", "tpex", "finmind"):
        for name, rec in r[group].items():
            if not isinstance(rec, dict) or "url" not in rec:
                continue
            note = rec.get("stat") or rec.get("msg") or rec.get("error") or (rec.get("text_head") or "")[:40]
            if rec.get("date_range"):
                note = f"{note} {rec['date_range'][0]}~{rec['date_range'][1]}"
            lines.append(f"| {name} | {rec.get('status')} | {rec.get('rows', '')} | {round((rec.get('bytes') or 0) / 1024)} | {rec.get('secs')} | {str(note).replace('|', '/')} |")
    lines += ["", f"櫃買 OpenAPI 路徑數：{len(r['tpex'].get('openapi_all_paths', []))}", "", "## 頻率測試（每 3 秒一次）", ""]
    lines += [f"- {p['date']}: HTTP {p['status']} {p['stat']} rows={p['rows']} {p['secs']}s" for p in r["twse_rate_probe_3s"]]
    lines += ["", "## 資料大小估算", "", "```", json.dumps(r["sizes"], ensure_ascii=False, indent=2), "```"]
    with open(os.path.join(OUT, "poc_summary.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")


# ---------- 公布時間探測 ----------

def run_publish():
    t = now_tw()
    d = t.date()
    if d.weekday() >= 5:
        print("週末，不探測")
        return
    checks = {}
    eps = twse_daily_endpoints(d) | {k: v for k, v in tpex_daily_endpoints(d).items()}
    for name, (url, params) in eps.items():
        rec = summarize(get(url, params), keep_sample=False)
        checks[name] = {"status": rec.get("status"), "stat": rec.get("stat"), "rows": rec.get("rows"),
                        "available": bool(ok(rec) and str(rec.get("stat", "OK")).upper() in ("OK", "200", "SUCCESS", "NONE"))}
        time.sleep(POLITE_DELAY)
    # OpenAPI 當日行情：看資料日期是不是今天
    oa = summarize(get(TWSE_OPENAPI["twse_openapi_日行情_STOCK_DAY_ALL"]))
    sample_date = (oa.get("sample") or {}).get("Date") if isinstance(oa.get("sample"), dict) else None
    checks["twse_openapi_STOCK_DAY_ALL"] = {"status": oa.get("status"), "rows": oa.get("rows"), "data_date": sample_date,
                                            "available": sample_date == roc(d, sep="")}
    line = {"checked_at": t.isoformat(timespec="minutes"), "date": str(d), "checks": checks}
    with open(os.path.join(OUT, "publish_times.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")
    print(json.dumps(line, ensure_ascii=False, indent=1))


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "full"
    run_publish() if mode == "publish" else run_full()
