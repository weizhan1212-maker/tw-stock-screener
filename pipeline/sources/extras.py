"""
市場總覽與排行榜用的補充資料：
- 證交所（可指定日期）：三大法人買賣金額 BFI82U、當沖 TWTB4U、借券賣出 TWT93U、鉅額交易 BFIAUU、類股指數 MI_INDEX(IND)
- 櫃買（OpenAPI 只有最新一天）：法人金額、當沖統計、借券、鉅額；櫃買指數（新版網站，可查月份）
- 期交所（OpenAPI 最新一天）：台指期近月一般／盤後
"""
import datetime as dt

import pandas as pd

from ..util import clean_code, roc_to_date, security_type, to_num
from .common import find_table

TW = "https://www.twse.com.tw/rwd/zh"
TP = "https://www.tpex.org.tw"


def twse_requests(d: dt.date) -> dict:
    ymd = d.strftime("%Y%m%d")
    return {
        "insti_amount": (f"{TW}/fund/BFI82U", {"type": "day", "dayDate": ymd, "response": "json"}),
        "daytrade": (f"{TW}/dayTrading/TWTB4U", {"date": ymd, "selectType": "All", "response": "json"}),
        "sbl": (f"{TW}/marginTrading/TWT93U", {"date": ymd, "response": "json"}),
        "block": (f"{TW}/block/BFIAUU", {"date": ymd, "selectType": "S", "response": "json"}),
    }


def indices_request(d: dt.date):
    return f"{TW}/afterTrading/MI_INDEX", {"date": d.strftime("%Y%m%d"), "type": "IND", "response": "json"}


def margin_request(d: dt.date):
    return f"{TW}/marginTrading/MI_MARGN", {"date": d.strftime("%Y%m%d"), "selectType": "MS", "response": "json"}


LATEST = {
    "tpex_insti_amount": f"{TP}/openapi/v1/tpex_3insti_summary",
    "tpex_daytrade": f"{TP}/openapi/v1/tpex_intraday_trading_statistics",
    "tpex_sbl": f"{TP}/openapi/v1/tpex_margin_sbl",
    "tpex_block": f"{TP}/openapi/v1/tpex_daily_trading_block",
    "futures": "https://openapi.taifex.com.tw/v1/DailyMarketReportFut",
    "dca_rank": "https://openapi.twse.com.tw/v1/ETFReport/ETFRank",
    # 市場情緒（期交所 OpenAPI，約保留最近 20 個交易日，每天累積）
    "pcr": "https://openapi.taifex.com.tw/v1/PutCallRatio",
    "fut_large": "https://openapi.taifex.com.tw/v1/OpenInterestOfLargeTradersFutures",
    "fut_insti": "https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate",
    "fx": "https://openapi.taifex.com.tw/v1/DailyForeignExchangeRates",
}


def parse_dca_rank(body) -> dict:
    """證交所定期定額交易戶數排行（前 20 名個股與 ETF，每月更新）。"""
    stocks, etfs = [], []
    for r in body if isinstance(body, list) else []:
        for kind, out in (("STOCKs", stocks), ("ETFs", etfs)):
            code = str(r.get(f"{kind}SecurityCode") or "").strip()
            n = to_num(r.get(f"{kind}NumberofTradingAccounts"))
            if code and n == n:
                out.append({"code": code, "name": str(r.get(f"{kind}Name") or "").strip(), "accounts": int(n)})
    return {"stocks": stocks, "etfs": etfs}


def tpex_index_request(month: dt.date):
    return f"{TP}/www/zh-tw/indexInfo/inx", {"date": month.strftime("%Y/%m/01"), "response": "json"}


def _ok(body) -> bool:
    return isinstance(body, dict) and body.get("stat") == "OK"


# ---------- 證交所 ----------

def parse_insti_amount(body, d: dt.date) -> pd.DataFrame:
    if not _ok(body):
        return pd.DataFrame()
    v = {str(r[0]).strip(): to_num(r[3]) for r in body.get("data") or []}
    g = lambda *ks: sum(v.get(k, 0) or 0 for k in ks)  # noqa: E731
    return pd.DataFrame([{
        "date": pd.Timestamp(d), "market": "TWSE",
        "foreign": g("外資及陸資(不含外資自營商)", "外資自營商"), "trust": g("投信"),
        "dealer": g("自營商(自行買賣)", "自營商(避險)"), "total": v.get("合計"),
    }])


def parse_daytrade(body, d: dt.date) -> dict:
    if not _ok(body):
        return {}
    out = {}
    tot = find_table(body, "當日沖銷交易統計")
    if tot and tot.get("data"):
        r = tot["data"][0]
        out["daytrade_total"] = pd.DataFrame([{"date": pd.Timestamp(d), "market": "TWSE",
                                               "volume": to_num(r[0]), "volume_ratio": to_num(r[1]),
                                               "buy_value": to_num(r[2]), "sell_value": to_num(r[4])}])
    t = find_table(body, "當日沖銷交易標的")
    recs = []
    for r in (t or {}).get("data") or []:
        code = clean_code(r[0])
        if security_type(code):
            recs.append({"date": pd.Timestamp(d), "code": code, "market": "TWSE", "dt_volume": to_num(r[3]),
                         "dt_buy_value": to_num(r[4]), "dt_sell_value": to_num(r[5])})
    out["daytrade"] = pd.DataFrame.from_records(recs)
    return out


def parse_sbl(body, d: dt.date) -> pd.DataFrame:
    """TWT93U：後半段是借券賣出（股）：[9] 當日賣出 [10] 當日還券 [12] 當日餘額。"""
    if not _ok(body):
        return pd.DataFrame()
    recs = []
    for r in body.get("data") or []:
        code = clean_code(r[0])
        if security_type(code) and len(r) > 12:
            recs.append({"date": pd.Timestamp(d), "code": code, "market": "TWSE",
                         "sbl_sell": to_num(r[9]), "sbl_return": to_num(r[10]), "sbl_balance": to_num(r[12])})
    return pd.DataFrame.from_records(recs)


def parse_block(body, d: dt.date) -> pd.DataFrame:
    if not _ok(body):
        return pd.DataFrame()
    recs = []
    for r in body.get("data") or []:
        code = clean_code(r[0])
        if security_type(code):
            recs.append({"code": code, "shares": to_num(r[4]), "value": to_num(r[5])})
    df = pd.DataFrame.from_records(recs)
    if df.empty:
        return df
    g = df.groupby("code").agg(block_shares=("shares", "sum"), block_value=("value", "sum"),
                               block_trades=("value", "size")).reset_index()
    g["date"], g["market"] = pd.Timestamp(d), "TWSE"
    return g


# ---------- 櫃買（OpenAPI 最新一天） ----------

def parse_tpex_insti_amount(rows) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame()
    d = roc_to_date(rows[0].get("Date"))
    v = {str(r.get("Investor", "")).strip().replace("　", ""): to_num(r.get("Net")) for r in rows}
    return pd.DataFrame([{"date": pd.Timestamp(d), "market": "TPEX", "foreign": v.get("外資及陸資合計"),
                          "trust": v.get("投信"), "dealer": v.get("自營商合計"),
                          "total": v.get("三大法人合計*", v.get("三大法人合計"))}])


def parse_tpex_daytrade(rows) -> pd.DataFrame:
    recs = [{"date": pd.Timestamp(roc_to_date(r.get("Date"))), "market": "TPEX",
             "volume": to_num(r.get("DayTradingVolume")), "volume_ratio": to_num(r.get("DayTradingVolumeOfTheMarket")),
             "buy_value": to_num(r.get("DayTradingValueOfBuys")), "sell_value": to_num(r.get("DayTradingValueOfSells"))}
            for r in rows or [] if roc_to_date(r.get("Date"))]
    return pd.DataFrame.from_records(recs)


def parse_tpex_sbl(rows) -> pd.DataFrame:
    recs = []
    for r in rows or []:
        code = clean_code(r.get("SecuritiesCompanyCode"))
        d = roc_to_date(r.get("Date"))
        if security_type(code) and d:
            recs.append({"date": pd.Timestamp(d), "code": code, "market": "TPEX",
                         "sbl_sell": to_num(r.get("SecuritiesBorrowingSale")),
                         "sbl_return": to_num(r.get("SecuritiesBorrowingReturn")),
                         "sbl_balance": to_num(r.get("SecuritiesBorrowingBalanceOfTheMarketDay"))})
    return pd.DataFrame.from_records(recs)


def parse_tpex_block(rows, name_to_code: dict) -> pd.DataFrame:
    """櫃買鉅額交易只有名稱沒有代號，用股票清單的名稱對回代號；只取最新一天。"""
    recs = []
    for r in rows or []:
        d = roc_to_date(r.get("TradingDate"))
        code = name_to_code.get(str(r.get("Name", "")).strip())
        if d and code:
            recs.append({"date": pd.Timestamp(d), "code": code, "shares": to_num(r.get("NumberOfSharesTraded")),
                         "value": to_num(r.get("TradingValue"))})
    df = pd.DataFrame.from_records(recs)
    if df.empty:
        return df
    df = df[df["date"] == df["date"].max()]
    g = df.groupby(["date", "code"]).agg(block_shares=("shares", "sum"), block_value=("value", "sum"),
                                         block_trades=("value", "size")).reset_index()
    g["market"] = "TPEX"
    return g


def parse_tpex_index(body) -> pd.DataFrame:
    if not isinstance(body, dict) or not body.get("tables"):
        return pd.DataFrame()
    recs, prev = [], None
    for r in body["tables"][0].get("data") or []:
        d = pd.to_datetime(str(r[0]).replace("/", "-"), errors="coerce")
        close, chg = to_num(r[4]), to_num(r[5])
        if pd.isna(d) or close != close:
            continue
        base = close - chg if chg == chg else prev
        recs.append({"date": d, "name": "櫃買指數", "market": "TPEX", "close": close, "chg": chg,
                     "chg_pct": chg / base * 100 if base else float("nan")})
        prev = close
    return pd.DataFrame.from_records(recs)


# ---------- 期交所 ----------

def parse_futures(rows) -> pd.DataFrame:
    """台指期（TX）近月合約，一般與盤後各一筆。"""
    recs = []
    for r in rows or []:
        if str(r.get("Contract", "")).strip() != "TX":
            continue
        month = str(r.get("ContractMonth(Week)", "")).strip()
        if "/" in month or not month.isdigit():         # 排除價差、週契約
            continue
        recs.append({"date": pd.to_datetime(str(r.get("Date")), format="%Y%m%d", errors="coerce"),
                     "session": "盤後" if "盤後" in str(r.get("TradingSession", "")) else "一般",
                     "month": month, "close": to_num(r.get("Last")), "chg": to_num(r.get("Change")),
                     "chg_pct": to_num(str(r.get("%", "")).replace("%", "")), "volume": to_num(r.get("Volume")),
                     "oi": to_num(r.get("OpenInterest"))})
    df = pd.DataFrame.from_records(recs)
    if df.empty:
        return df
    df = df.sort_values("month").groupby(["date", "session"], as_index=False).first()   # 近月
    return df


# ---------- 市場情緒（期交所） ----------

def _d(x):
    return pd.to_datetime(str(x), format="%Y%m%d", errors="coerce")


def parse_pcr(rows) -> pd.DataFrame:
    """台指選擇權 Put/Call 比（成交量、未平倉，單位 %）。"""
    return pd.DataFrame.from_records([{
        "date": _d(r.get("Date")), "pcr_vol": to_num(r.get("PutCallVolumeRatio%")), "pcr_oi": to_num(r.get("PutCallOIRatio%")),
        "put_oi": to_num(r.get("PutOI")), "call_oi": to_num(r.get("CallOI")),
    } for r in rows or []]).dropna(subset=["date"]) if rows else pd.DataFrame()


def parse_fut_large(rows) -> pd.DataFrame:
    """台指期大額交易人未沖銷部位（全部月份合計）：前五大／前十大的買減賣（口），以及特定法人的前十大。"""
    recs = {}
    for r in rows or []:
        if str(r.get("Contract", "")).strip() != "TX" or str(r.get("SettlementMonth", "")).strip() != "999912":
            continue
        d = _d(r.get("Date"))
        x = recs.setdefault(d, {"date": d})
        net5 = to_num(r.get("Top5Buy")) - to_num(r.get("Top5Sell"))
        net10 = to_num(r.get("Top10Buy")) - to_num(r.get("Top10Sell"))
        if str(r.get("TypeOfTraders", "")).strip() == "0":
            x.update(top5_net=net5, top10_net=net10, oi=to_num(r.get("OIOfMarket")))
        else:
            x.update(top10_net_inst=net10)
    return pd.DataFrame.from_records(list(recs.values()))


def parse_fut_insti(rows) -> pd.DataFrame:
    """三大法人台股期貨未平倉淨口數（外資、投信、自營商）。"""
    key = {"外資及陸資": "foreign", "投信": "trust", "自營商": "dealer"}
    recs = {}
    for r in rows or []:
        if str(r.get("ContractCode", "")).strip() != "臺股期貨":
            continue
        who = key.get(str(r.get("Item", "")).strip())
        if not who:
            continue
        d = _d(r.get("Date"))
        recs.setdefault(d, {"date": d})[f"{who}_oi_net"] = to_num(r.get("OpenInterest(Net)"))
    return pd.DataFrame.from_records(list(recs.values()))


def parse_fx(rows) -> pd.DataFrame:
    """美元兌新台幣（期交所每日參考匯率）。"""
    return pd.DataFrame.from_records([{"date": _d(r.get("Date")), "usd_twd": to_num(r.get("USD/NTD"))} for r in rows or []]
                                     ).dropna(subset=["date"]) if rows else pd.DataFrame()


# ---------- 國發會景氣對策信號（政府資料開放平臺 dataset 6099，每月） ----------

NDC_DATASET = "https://data.gov.tw/api/v2/rest/dataset/6099"


def parse_business_light(zip_bytes: bytes) -> list[dict]:
    """從「景氣指標及燈號」ZIP 取出每月景氣對策信號綜合分數與燈號。"""
    import csv
    import io
    import zipfile
    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    name = next(n for n in z.namelist() if n.endswith("景氣指標與燈號.csv") and not n.startswith("schema"))
    rows = list(csv.DictReader(io.StringIO(z.read(name).decode("utf-8-sig"))))
    out = []
    for r in rows:
        score = to_num(r.get("景氣對策信號綜合分數"))
        if score != score:          # NaN
            continue
        out.append({"month": str(r.get("Date", "")).strip(), "score": score, "light": str(r.get("景氣對策信號", "")).strip()})
    return out
