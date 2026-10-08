"""探測：舊日期（2016–2021）各端點能不能抓、解析出幾筆（不寫入任何資料）"""
import datetime as dt
import sys

sys.path.insert(0, ".")
from pipeline import jobs  # noqa: E402
from pipeline.http import Fetcher  # noqa: E402

f = Fetcher()
for s in ["2016-10-12", "2017-06-14", "2018-11-07", "2019-08-14", "2020-03-18", "2021-05-19"]:
    d = dt.date.fromisoformat(s)
    st, fr = jobs.fetch_day(f, d, None, False, set())
    rows = {k: sum(len(x) for x in v) for k, v in fr.items()}
    print(s, st if st == "holiday" else {k: v for k, v in st.items()}, rows, flush=True)
    if not isinstance(st, dict):
        continue
    for k, v in fr.items():
        if v:
            print("   ", k, list(v[0].columns)[:12], v[0].head(1).to_dict("records"))
