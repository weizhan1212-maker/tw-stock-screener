"""探測市場情緒資料源的欄位格式（期交所 OpenAPI、國發會景氣燈號）。只印欄位與前幾筆，不寫入資料。"""
import json
import sys

import requests

S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (tw-stock-screener probe)"
URLS = [
    "https://openapi.taifex.com.tw/v1/PutCallRatio",
    "https://openapi.taifex.com.tw/v1/OpenInterestOfLargeTradersFutures",
    "https://openapi.taifex.com.tw/v1/DailyForeignExchangeRates",
    "https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDividedByFuturesAndOptionsBytheDate",
    "https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate",
    "https://index.ndc.gov.tw/n/json/data/eco/indicators",
    "https://index.ndc.gov.tw/n/json/lightscore",
]
for u in URLS:
    try:
        r = S.get(u, timeout=30)
        print(f"\n=== {u}  HTTP {r.status_code}  {r.headers.get('content-type')}  {len(r.content)} bytes")
        try:
            j = r.json()
        except ValueError:
            print(r.text[:400])
            continue
        if isinstance(j, list):
            print("rows:", len(j), "keys:", list(j[0].keys()) if j else None)
            for x in j[:4]:
                print(json.dumps(x, ensure_ascii=False))
            if j and "TX" in json.dumps(j, ensure_ascii=False):
                for x in [x for x in j if "TX" in json.dumps(x, ensure_ascii=False) or "臺股期貨" in json.dumps(x, ensure_ascii=False)][:6]:
                    print("TX:", json.dumps(x, ensure_ascii=False))
        else:
            print(json.dumps(j, ensure_ascii=False)[:1500])
    except Exception as e:  # noqa: BLE001
        print(f"\n=== {u} 失敗：{e}", file=sys.stdout)
