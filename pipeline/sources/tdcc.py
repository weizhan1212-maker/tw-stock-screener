"""集保結算所「集保戶股權分散表」（每週五更新，只有最新一週）。

持股分級：1=1-999 股、2=1-5 張、3=5-10 張、…、11=200-400 張、12=400-600 張、13=600-800 張、
14=800-1,000 張、15=1,000 張以上、16=差異數調整、17=合計。
"""
import csv
import io

import pandas as pd

from ..util import security_type, ymd_to_date

URL = "https://opendata.tdcc.com.tw/getOD.ashx?id=1-5"


def parse(text: str) -> pd.DataFrame:
    """回傳每檔一列：date, code, holders（總人數）, holders_1000（千張大戶人數）,
    pct_1000（千張以上持股比例）, pct_400（400 張以上）, pct_retail（10 張以下）。"""
    rows = list(csv.reader(io.StringIO(text)))
    if not rows:
        return pd.DataFrame()
    head = [h.strip() for h in rows[0]]
    if "證券代號" not in head:
        raise ValueError(f"集保欄位改變：{head}")
    i_date, i_code, i_lv = head.index("資料日期"), head.index("證券代號"), head.index("持股分級")
    i_n, i_pct = head.index("人數"), [i for i, h in enumerate(head) if h.startswith("占集保庫存數比例")][0]
    acc: dict = {}
    for r in rows[1:]:
        if len(r) <= max(i_date, i_code, i_lv, i_n, i_pct):
            continue
        code = r[i_code].strip()
        if security_type(code) is None:
            continue
        try:
            lv, n, pct = int(r[i_lv]), float(r[i_n]), float(r[i_pct])
        except ValueError:
            continue
        a = acc.setdefault(code, {"date": r[i_date].strip(), "code": code, "holders": None, "holders_1000": 0.0,
                                  "pct_1000": 0.0, "pct_400": 0.0, "pct_retail": 0.0})
        if lv == 17:
            a["holders"] = n
        if lv == 15:
            a["holders_1000"] = n
            a["pct_1000"] = pct
        if 12 <= lv <= 15:
            a["pct_400"] += pct
        if 1 <= lv <= 3:
            a["pct_retail"] += pct
    df = pd.DataFrame(acc.values())
    if df.empty:
        return df
    df["date"] = pd.to_datetime(df["date"].map(ymd_to_date))
    return df.dropna(subset=["date"]).reset_index(drop=True)
