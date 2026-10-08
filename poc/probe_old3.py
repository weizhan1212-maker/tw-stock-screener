"""探測：櫃買三大法人 2018 年以前（新網址所有表＋舊網址）"""
import datetime as dt
import json
import sys

sys.path.insert(0, ".")
from pipeline.http import Fetcher  # noqa: E402
from pipeline.sources import tpex  # noqa: E402

f = Fetcher()
for s in ["2016-10-12", "2017-12-29"]:
    d = dt.date.fromisoformat(s)
    url, params = tpex.requests_for(d)["tpex_insti"]
    b = f.get_json(url, params)
    print(s, "keys", list(b.keys()), "stat", b.get("stat"), "date", b.get("date"))
    for i, t in enumerate(b.get("tables") or []):
        print(f"  表{i}", t.get("title"), len(t.get("fields") or []), json.dumps(t.get("fields"), ensure_ascii=False)[:600])
        for row in (t.get("data") or [])[:2]:
            print("     ", json.dumps(row, ensure_ascii=False)[:400])
    roc = f"{d.year - 1911}/{d.month:02d}/{d.day:02d}"
    for p in [{"l": "zh-tw", "se": "EW", "t": "D", "d": roc}, {"l": "zh-tw", "se": "AL", "t": "D", "d": roc}]:
        try:
            o = f.get_json("https://www.tpex.org.tw/web/stock/3insti/daily_trade/3itrade_hedge_result.php", p)
            aa = o.get("aaData") or []
            print("  舊網址", p, "筆數", len(aa), "欄數", len(aa[0]) if aa else 0, json.dumps(aa[:1], ensure_ascii=False)[:500])
        except Exception as e:
            print("  舊網址 ERR", p, e)
