"""探測國發會景氣對策信號的開放資料下載網址（透過政府資料開放平臺 API）。"""
import json
import requests

S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (tw-stock-screener probe)"
for ds in ("6099", "31564", "6100", "6098"):
    try:
        r = S.get(f"https://data.gov.tw/api/v2/rest/dataset/{ds}", timeout=30)
        j = r.json()
        res = j.get("result", {})
        print(f"\n=== dataset {ds}: {res.get('title')} | {res.get('publisher')} | {res.get('license')}")
        for d in res.get("distribution", [])[:6]:
            print(" -", d.get("resourceDescription"), d.get("resourceFormat"), d.get("resourceDownloadUrl"))
    except Exception as e:  # noqa: BLE001
        print(ds, "失敗", e, r.text[:200] if 'r' in dir() else "")
r = S.get("https://data.gov.tw/api/v2/rest/dataset", params={"q": "景氣對策信號"}, timeout=30)
print("\nsearch:", r.status_code, r.text[:1500])
