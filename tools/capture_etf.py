"""擷取 ETF 資料源的真實回應作為測試樣本（tests/fixtures/etf_*）：證交所 ETF 淨值表、證交所基金基本資料、投信投顧公會月前十大。"""
import gzip
import os
import sys

import requests

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from pipeline.sources import etf  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tests", "fixtures")
os.makedirs(OUT, exist_ok=True)
S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) tw-stock-screener/0.1"})


def save(name, data: bytes):
    with gzip.open(os.path.join(OUT, name + ".gz"), "wb") as f:
        f.write(data)
    print(name, len(data))


r = S.get(etf.NAV_URL, timeout=60)
save("etf_nav.json", r.content)
r = S.get("https://openapi.twse.com.tw/v1/opendata/t187ap47_L", timeout=60)
save("etf_twse_info.json", r.content)
page = S.get(etf.SITCA_TOP10, timeout=60)
print("sitca GET", page.status_code, len(page.text))
months = etf.sitca_months(page.text)
ym = months[-1] if months else ""
print("months", months[-3:])
hidden = etf.sitca_form(page.text)
for cls in etf.SITCA_CLASSES:
    r = S.post(etf.SITCA_TOP10, data=etf.sitca_payload(hidden, ym, cls), timeout=90)
    print(cls, r.status_code, len(r.text))
    save(f"etf_sitca_{cls}_{ym}.html", r.content)
