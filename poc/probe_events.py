"""探測：重大訊息、法說會的合法開放資料來源（只印格式，不寫入資料）"""
import json, requests
H = {"User-Agent": "Mozilla/5.0"}
KEYS = ["重大訊息", "法說", "法人說明", "說明會"]

def sw(name, url):
    print(f"\n===== {name} swagger: {url}")
    try:
        d = requests.get(url, headers=H, timeout=30).json()
    except Exception as e:
        print("ERR", e); return []
    hits = []
    for p, v in d.get("paths", {}).items():
        s = json.dumps(v, ensure_ascii=False)
        if any(k in s for k in KEYS):
            summ = next(iter(v.values())).get("summary")
            print(p, summ); hits.append(p)
    return hits

def sample(base, p):
    url = base + p
    try:
        r = requests.get(url, headers=H, timeout=30); j = r.json()
        print(f"\n--- {url} status={r.status_code} rows={len(j) if isinstance(j, list) else '?'}")
        for row in (j[:2] if isinstance(j, list) else [j]):
            print(json.dumps(row, ensure_ascii=False)[:800])
    except Exception as e:
        print("ERR", url, e)

for name, swurl, base in [
    ("TWSE", "https://openapi.twse.com.tw/v1/swagger.json", "https://openapi.twse.com.tw/v1"),
    ("TPEx", "https://www.tpex.org.tw/openapi/swagger.json", "https://www.tpex.org.tw/openapi"),
]:
    for p in sw(name, swurl):
        sample(base, p)

print("\n===== data.gov.tw 搜尋")
for q in ["法人說明會", "重大訊息"]:
    try:
        r = requests.get("https://data.gov.tw/api/front/dataset/list", params={"q": q, "size": 10}, headers=H, timeout=30)
        print(q, r.status_code, r.text[:1500])
    except Exception as e:
        print("ERR", q, e)
