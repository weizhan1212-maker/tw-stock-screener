"""探測 2：上櫃重大訊息格式、重大訊息涵蓋天數、法說會相關筆數"""
import json, collections, requests
H = {"User-Agent": "Mozilla/5.0"}
for name, url in [("TWSE", "https://openapi.twse.com.tw/v1/opendata/t187ap04_L"),
                  ("TPEx", "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O")]:
    try:
        j = requests.get(url, headers=H, timeout=30).json()
    except Exception as e:
        print(name, "ERR", e); continue
    print(f"\n===== {name} rows={len(j)} keys={list(j[0].keys()) if j else None}")
    dk = next((k for k in (j[0] if j else {}) if "發言日期" in k or k == "Date"), None)
    print("日期分布", collections.Counter(r.get(dk) for r in j).most_common(5))
    print("條款分布", collections.Counter((r.get("符合條款") or r.get("CompliedArticles") or "").strip() for r in j).most_common(8))
    for r in j:
        s = json.dumps(r, ensure_ascii=False)
        if "法人說明會" in s or "法說" in s:
            print("法說:", s[:500])
    if j: print("樣本:", json.dumps(j[0], ensure_ascii=False)[:400])
