"""探測國發會景氣指標及燈號 ZIP 內容（政府資料開放平臺 dataset 6099）。"""
import io
import zipfile

import requests

S = requests.Session()
S.headers["User-Agent"] = "Mozilla/5.0 (tw-stock-screener probe)"
j = S.get("https://data.gov.tw/api/v2/rest/dataset/6099", timeout=30).json()
url = j["result"]["distribution"][0]["resourceDownloadUrl"]
z = zipfile.ZipFile(io.BytesIO(S.get(url, timeout=60).content))
for n in z.namelist():
    raw = z.read(n)
    for enc in ("utf-8-sig", "big5", "cp950"):
        try:
            t = raw.decode(enc)
            break
        except UnicodeDecodeError:
            t = None
    print(f"\n=== {n}（{len(raw)} bytes，{enc}）")
    if t:
        lines = t.splitlines()
        print("\n".join(lines[:4]))
        print("...")
        print("\n".join(lines[-3:]))
