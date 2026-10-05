"""
擷取各資料源的真實回應作為測試樣本（tests/fixtures/）。
大型表格只保留前 40 列＋觀察名單，讓樣本檔小、但仍涵蓋各種代號格式（普通股、ETF、債券 ETF、權證、特別股）。

用法：python tools/capture_fixtures.py
"""
import gzip
import json
import os
import time

import requests

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests", "fixtures")
os.makedirs(OUT, exist_ok=True)
S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) tw-stock-screener/0.1"})
WATCH = {"2330", "1101", "2317", "2881", "2881A", "0050", "00878", "00679B", "006208", "00632R",
         "6488", "8069", "3105", "006201", "00400A", "2412", "9958", "1240", "3529", "5347"}
TOKEN = os.environ.get("FINMIND_TOKEN", "").strip()


def trim_rows(rows, code_idx=0, keep=40):
    if not isinstance(rows, list) or len(rows) <= keep + 10:
        return rows
    head = rows[:keep]
    def code(r):
        if isinstance(r, dict):
            for k in ("stock_id", "Code", "公司代號", "SecuritiesCompanyCode", "股票代號", "證券代號", "代號"):
                if k in r:
                    return str(r[k]).strip()
            return ""
        return str(r[code_idx]).strip() if r else ""
    extra = [r for r in rows[keep:] if code(r) in WATCH]
    # 再加幾列六位數代號（權證、ETN 等），測試過濾邏輯
    six = [r for r in rows[keep:] if len(code(r)) == 6 and code(r)[0] in "0123456789"][:5]
    return head + extra + six


def trim(obj):
    if isinstance(obj, list):
        return trim_rows(obj)
    if isinstance(obj, dict):
        o = dict(obj)
        if isinstance(o.get("tables"), list):
            o["tables"] = [dict(t, data=trim_rows(t.get("data") or [])) if "指數" not in str(t.get("title")) else t
                           for t in o["tables"]]
        for k in ("data", "aaData"):
            if isinstance(o.get(k), list):
                o[k] = trim_rows(o[k])
        return o
    return obj


def cap(name, url, params=None):
    try:
        r = S.get(url, params=params, timeout=60)
        try:
            j = r.json()
        except Exception:
            j = {"_non_json": r.text[:500]}
        data = {"_meta": {"url": url, "params": {k: v for k, v in (params or {}).items() if k != "token"},
                          "status": r.status_code}, "body": trim(j)}
    except Exception as e:
        data = {"_meta": {"url": url, "error": repr(e)}}
    if "error" in data["_meta"] and os.path.exists(os.path.join(OUT, name + ".json")):
        print(name, "失敗，保留舊樣本：", data["_meta"]["error"])
        time.sleep(3)
        return
    with open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)
    print(name, data["_meta"].get("status"), data["_meta"].get("error", ""))
    time.sleep(3)


def main():
    tw = "https://www.twse.com.tw/rwd/zh"
    tp = "https://www.tpex.org.tw/www/zh-tw"
    for tag, ymd, slash in (("2026", "20261002", "2026/10/02"), ("2022", "20220103", "2022/01/03")):
        cap(f"twse_mi_index_{tag}", f"{tw}/afterTrading/MI_INDEX", {"date": ymd, "type": "ALLBUT0999", "response": "json"})
        cap(f"twse_t86_{tag}", f"{tw}/fund/T86", {"date": ymd, "selectType": "ALLBUT0999", "response": "json"})
        cap(f"twse_margin_{tag}", f"{tw}/marginTrading/MI_MARGN", {"date": ymd, "selectType": "ALL", "response": "json"})
        cap(f"twse_bwibbu_{tag}", f"{tw}/afterTrading/BWIBBU_d", {"date": ymd, "selectType": "ALL", "response": "json"})
        cap(f"twse_qfiis_{tag}", f"{tw}/fund/MI_QFIIS", {"date": ymd, "selectType": "ALLBUT0999", "response": "json"})
        cap(f"tpex_quotes_{tag}", f"{tp}/afterTrading/dailyQuotes", {"date": slash, "response": "json"})
        cap(f"tpex_insti_{tag}", f"{tp}/insti/dailyTrade", {"type": "Daily", "sect": "EW", "date": slash, "response": "json"})
        cap(f"tpex_margin_{tag}", f"{tp}/margin/balance", {"date": slash, "response": "json"})
        cap(f"tpex_pe_{tag}", f"{tp}/afterTrading/peQryDate", {"date": slash, "response": "json"})
    # 非交易日（週六）的回應長什麼樣
    cap("twse_mi_index_holiday", f"{tw}/afterTrading/MI_INDEX", {"date": "20261003", "type": "ALLBUT0999", "response": "json"})
    cap("tpex_quotes_holiday", f"{tp}/afterTrading/dailyQuotes", {"date": "2026/10/03", "response": "json"})
    # 指數：類股指數（某日全部）、加權指數月 OHLC、櫃買指數月資料
    cap("twse_mi_index_ind_2023", f"{tw}/afterTrading/MI_INDEX", {"date": "20230103", "type": "IND", "response": "json"})
    cap("twse_taiex_ohlc_202609", f"{tw}/TAIEX/MI_5MINS_HIST", {"date": "20260901", "response": "json"})
    cap("twse_taiex_ohlc_202301", f"{tw}/TAIEX/MI_5MINS_HIST", {"date": "20230101", "response": "json"})
    cap("twse_twt49u_2026", f"{tw}/exRight/TWT49U", {"startDate": "20260801", "endDate": "20261002", "response": "json"})
    oa = "https://openapi.twse.com.tw/v1"
    cap("twse_oa_company", f"{oa}/opendata/t187ap03_L")
    cap("twse_oa_revenue", f"{oa}/opendata/t187ap05_L")
    cap("twse_oa_income", f"{oa}/opendata/t187ap06_L_ci")
    cap("twse_oa_holiday", f"{oa}/holidaySchedule/holidaySchedule")
    to = "https://www.tpex.org.tw/openapi/v1"
    cap("tpex_oa_company", f"{to}/mopsfin_t187ap03_O")
    cap("tpex_oa_revenue", f"{to}/mopsfin_t187ap05_O")
    cap("tpex_oa_income", f"{to}/mopsfin_t187ap06_O_ci")
    cap("tpex_oa_qfii", f"{to}/tpex_3insti_qfii")
    cap("tpex_oa_exright", f"{to}/tpex_exright_daily")
    fm = "https://api.finmindtrade.com/api/v4/data"
    for ds in ("TaiwanStockFinancialStatements", "TaiwanStockBalanceSheet", "TaiwanStockCashFlowsStatement",
               "TaiwanStockMonthRevenue", "TaiwanStockDividend"):
        p = {"dataset": ds, "data_id": "2330", "start_date": "2025-01-01"}
        if TOKEN:
            p["token"] = TOKEN
        cap(f"finmind_{ds}", fm, p)
    p = {"dataset": "TaiwanStockDelisting"}
    cap("finmind_TaiwanStockDelisting", fm, p)
    p = {"dataset": "TaiwanStockInfo"}
    cap("finmind_TaiwanStockInfo", fm, p)


if __name__ == "__main__":
    main()
