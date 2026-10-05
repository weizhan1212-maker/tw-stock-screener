"""
第 1 批（市場總覽＋排行榜）新資料源探測：存成 tests/fixtures/more_*.json，並輸出摘要 more_summary.md。
"""
import json
import os
import re
import time

import requests

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests", "fixtures")
os.makedirs(OUT, exist_ok=True)
S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) tw-stock-screener/1.0"})
summary = ["# 新資料源探測", ""]


def trim(o, n=30):
    if isinstance(o, list):
        return o[:n]
    if isinstance(o, dict):
        o = dict(o)
        for k, v in list(o.items()):
            if isinstance(v, list) and len(v) > n:
                o[k] = v[:n]
            if k == "tables" and isinstance(v, list):
                o[k] = [dict(t, data=(t.get("data") or [])[:n]) for t in v]
        return o
    return o


def shape(j):
    if isinstance(j, list):
        return f"list[{len(j)}] keys={list(j[0].keys())[:12] if j and isinstance(j[0], dict) else ''}"
    if isinstance(j, dict):
        parts = [f"stat={j.get('stat')}"]
        if j.get("tables"):
            parts.append("tables=" + "; ".join(f"{t.get('title')}({len(t.get('data') or [])}) {t.get('fields')}" for t in j["tables"][:6]))
        if j.get("fields"):
            parts.append(f"fields={j.get('fields')} rows={len(j.get('data') or [])}")
        if j.get("paths"):
            parts.append(f"paths={len(j['paths'])}")
        return " ".join(parts)
    return str(j)[:200]


def probe(name, url, params=None, raw=False):
    try:
        r = S.get(url, params=params, timeout=60)
        if raw:
            body = r.text[:20000]
            info = f"HTTP {r.status_code} text {len(r.text)} bytes"
            data = {"_meta": {"url": url, "params": params, "status": r.status_code}, "text": body}
        else:
            j = r.json()
            info = f"HTTP {r.status_code} {shape(j)}"
            data = {"_meta": {"url": url, "params": params, "status": r.status_code}, "body": trim(j)}
    except Exception as e:
        info, data = f"錯誤 {e!r}"[:300], {"_meta": {"url": url, "params": params, "error": repr(e)}}
    with open(os.path.join(OUT, f"more_{name}.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    summary.append(f"- **{name}**：{info}")
    print(name, info[:200])
    time.sleep(3)
    return data


tw = "https://www.twse.com.tw/rwd/zh"
d, ds = "20261002", "2026/10/02"
probe("twse_bfi82u", f"{tw}/fund/BFI82U", {"type": "day", "dayDate": d, "response": "json"})
probe("twse_twtb4u", f"{tw}/dayTrading/TWTB4U", {"date": d, "selectType": "All", "response": "json"})
probe("twse_twt93u", f"{tw}/marginTrading/TWT93U", {"date": d, "response": "json"})
probe("twse_block", f"{tw}/block/BFIAUU", {"date": d, "selectType": "S", "response": "json"})
probe("twse_mi_index_ind", f"{tw}/afterTrading/MI_INDEX", {"date": d, "type": "IND", "response": "json"})
sw = probe("twse_swagger", "https://openapi.twse.com.tw/v1/swagger.json")
paths = sorted(((sw.get("body") or {}).get("paths") or {}).keys()) if isinstance(sw.get("body"), dict) else []
summary.append("- 證交所 OpenAPI 路徑（含 Rank／ETF／定期）：" + ", ".join(p for p in paths if re.search(r"rank|etf|ETF|Rank|regular|TWT", p))[:3000])
tp = "https://www.tpex.org.tw"
probe("tpex_index_oa", f"{tp}/openapi/v1/tpex_index")
probe("tpex_index_hist", f"{tp}/www/zh-tw/indexInfo/inx", {"date": ds, "response": "json"})
probe("tpex_insti_summary", f"{tp}/openapi/v1/tpex_3insti_summary")
probe("tpex_daytrade", f"{tp}/openapi/v1/tpex_intraday_trading_statistics")
probe("tpex_sbl", f"{tp}/openapi/v1/tpex_margin_sbl")
probe("tpex_block", f"{tp}/openapi/v1/tpex_daily_trading_block")
probe("tpex_highlight", f"{tp}/openapi/v1/tpex_mainborad_highlight")
tf = probe("taifex_swagger", "https://openapi.taifex.com.tw/swagger.json")
tpaths = sorted(((tf.get("body") or {}).get("paths") or {}).keys()) if isinstance(tf.get("body"), dict) else []
summary.append("- 期交所 OpenAPI 路徑：" + ", ".join(tpaths)[:3000])
probe("taifex_fut", "https://openapi.taifex.com.tw/v1/DailyMarketReportFut")
probe("news_google", "https://news.google.com/rss/search", {"q": "台股", "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"}, raw=True)
probe("news_google_2330", "https://news.google.com/rss/search", {"q": "台積電 2330", "hl": "zh-TW", "gl": "TW", "ceid": "TW:zh-Hant"}, raw=True)
with open(os.path.join(OUT, "more_summary.md"), "w", encoding="utf-8") as f:
    f.write("\n".join(summary) + "\n")
