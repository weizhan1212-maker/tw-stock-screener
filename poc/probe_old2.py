"""探測：櫃買三大法人舊格式（16 欄）的欄位名稱與範例"""
import datetime as dt
import json
import sys

sys.path.insert(0, ".")
from pipeline.http import Fetcher  # noqa: E402
from pipeline.sources import tpex  # noqa: E402

f = Fetcher()
for s in ["2016-10-12", "2017-12-29", "2018-01-02", "2018-01-15", "2018-03-01", "2018-06-01"]:
    url, params = tpex.requests_for(dt.date.fromisoformat(s))["tpex_insti"]
    b = f.get_json(url, params)
    t = (b.get("tables") or [{}])[0]
    print(s, "欄位數", len(t.get("fields") or []), json.dumps(t.get("fields"), ensure_ascii=False))
    for row in (t.get("data") or [])[:2]:
        print("   ", json.dumps(row, ensure_ascii=False))
