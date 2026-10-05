"""測試共用：用 tests/fixtures 的真實回應模擬網路。"""
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
FIX = os.path.join(ROOT, "tests", "fixtures")


def load(name):
    with open(os.path.join(FIX, name + ".json"), encoding="utf-8") as f:
        return json.load(f)["body"]


TWSE_PATHS = {"MI_INDEX": "twse_mi_index", "T86": "twse_t86", "MI_MARGN": "twse_margin",
              "BWIBBU_d": "twse_bwibbu", "MI_QFIIS": "twse_qfiis"}
TPEX_PATHS = {"dailyQuotes": "tpex_quotes", "dailyTrade": "tpex_insti", "balance": "tpex_margin",
              "peQryDate": "tpex_pe"}
DATE_TAG = {"20261002": "2026", "20220103": "2022", "2026/10/02": "2026", "2022/01/03": "2022"}
OA = {"t187ap03_L": "twse_oa_company", "t187ap05_L": "twse_oa_revenue", "t187ap06_L_ci": "twse_oa_income",
      "holidaySchedule": "twse_oa_holiday", "mopsfin_t187ap03_O": "tpex_oa_company",
      "mopsfin_t187ap05_O": "tpex_oa_revenue", "mopsfin_t187ap06_O_ci": "tpex_oa_income",
      "tpex_3insti_qfii": "tpex_oa_qfii"}


class FakeFetcher:
    """依網址與日期參數回傳對應的樣本；沒有樣本的日期回傳「查無資料」。"""

    def __init__(self):
        self.count = 0
        self.calls = []

    def get_json(self, url, params=None, delay=None):
        self.count += 1
        params = params or {}
        self.calls.append((url, dict(params)))
        last = url.rstrip("/").rsplit("/", 1)[-1]
        if "twse.com.tw/rwd" in url:
            if last == "TWT49U":
                return load("twse_twt49u_2026")
            more = {"BFI82U": "twse_bfi82u", "TWTB4U": "twse_twtb4u", "TWT93U": "twse_twt93u", "BFIAUU": "twse_block"}
            if last in more:
                ok = (params.get("date") or params.get("dayDate")) == "20261002"
                return load(f"more_{more[last]}") if ok else {"stat": "很抱歉，沒有符合條件的資料!"}
            if last == "MI_INDEX" and params.get("type") == "IND":
                return load("more_twse_mi_index_ind") if params.get("date") == "20261002" else {"stat": "查無資料"}
            tag = DATE_TAG.get(params.get("date"))
            if tag and last in TWSE_PATHS:
                return load(f"{TWSE_PATHS[last]}_{tag}")
            return {"stat": "很抱歉，沒有符合條件的資料!"}
        if last == "inx":
            return load("more_tpex_index_hist")
        if "tpex.org.tw/www" in url:
            tag = DATE_TAG.get(params.get("date"))
            if tag and last in TPEX_PATHS:
                return load(f"{TPEX_PATHS[last]}_{tag}")
            return {"stat": "ok", "date": params.get("date", "").replace("/", ""), "tables": [{"title": "", "data": []}]}
        if last in OA:
            return load(OA[last])
        more_oa = {"tpex_3insti_summary": "tpex_insti_summary", "tpex_intraday_trading_statistics": "tpex_daytrade",
                   "tpex_margin_sbl": "tpex_sbl", "tpex_daily_trading_block": "tpex_block",
                   "DailyMarketReportFut": "taifex_fut"}
        if last in more_oa:
            return load(f"more_{more_oa[last]}")
        if "finmindtrade" in url:
            ds = params["dataset"]
            return load(f"finmind_{ds}")
        raise AssertionError(f"未預期的網址 {url}")


@pytest.fixture
def fake():
    return FakeFetcher()
