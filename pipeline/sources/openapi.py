"""證交所／櫃買 OpenAPI：公司基本資料、月營收（最新一期）、季報公布偵測、櫃買外資持股（最新）。"""
import datetime as dt
import re

import pandas as pd

from ..util import clean_code, roc_to_date, security_type, to_num

TWSE_OA = "https://openapi.twse.com.tw/v1"
TPEX_OA = "https://www.tpex.org.tw/openapi/v1"

URLS = {
    "twse_company": f"{TWSE_OA}/opendata/t187ap03_L",
    "tpex_company": f"{TPEX_OA}/mopsfin_t187ap03_O",
    "twse_revenue": f"{TWSE_OA}/opendata/t187ap05_L",
    "tpex_revenue": f"{TPEX_OA}/mopsfin_t187ap05_O",
    "twse_income": f"{TWSE_OA}/opendata/t187ap06_L_ci",
    "tpex_income": f"{TPEX_OA}/mopsfin_t187ap06_O_ci",
    "tpex_qfii": f"{TPEX_OA}/tpex_3insti_qfii",
    "twse_holiday": f"{TWSE_OA}/holidaySchedule/holidaySchedule",
    "twse_etf": f"{TWSE_OA}/opendata/t187ap47_L",          # 基金（ETF）基本資料彙總表
    "twse_events": f"{TWSE_OA}/opendata/t187ap04_L",       # 上市公司每日重大訊息（只有最近一個發言日）
    "tpex_events": f"{TPEX_OA}/mopsfin_t187ap04_O",        # 上櫃公司每日重大訊息
}


def _g(r, *keys):
    for k in keys:
        if k in r:
            return r[k]
    return None


def parse_company(rows, market: str) -> pd.DataFrame:
    recs = []
    for r in rows or []:
        code = clean_code(_g(r, "公司代號", "SecuritiesCompanyCode"))
        if security_type(code) != "stock":
            continue
        listed = str(_g(r, "上市日期", "DateOfListing") or "").strip()
        recs.append({
            "code": code, "market": market,
            "short_name": str(_g(r, "公司簡稱", "CompanyAbbreviation") or "").strip(),
            "industry_code": str(_g(r, "產業別", "SecuritiesIndustryCode") or "").strip(),
            "listed_date": pd.to_datetime(listed, format="%Y%m%d", errors="coerce"),
            "shares_issued": to_num(_g(r, "已發行普通股數或TDR原股發行股數", "IssueShares")),
            "capital": to_num(_g(r, "實收資本額", "Paidin.Capital.NTDollars")),
        })
    return pd.DataFrame.from_records(recs)


def _roc(v):
    try:
        d = roc_to_date(v)
        return d.isoformat() if d else None
    except (ValueError, TypeError):
        return None


def parse_etf_info(rows) -> pd.DataFrame:
    """上市 ETF 基本資料：類型、追蹤指數、上市日、發行單位數、經理人、績效指標（主動式）、成立日。"""
    recs = []
    for r in rows or []:
        code = clean_code(_g(r, "基金代號"))
        if security_type(code) != "etf":
            continue
        try:
            ld = roc_to_date(_g(r, "上市日期"))
        except ValueError:
            ld = None
        recs.append({
            "code": code,
            "etf_type": str(_g(r, "基金類型") or "").strip(),
            "etf_index": str(_g(r, "標的指數/追蹤指數名稱") or "").strip(),
            "etf_fullname": str(_g(r, "基金中文名稱") or "").strip(),
            "etf_foreign": str(_g(r, "是否包含國外成分股") or "").strip(),
            "etf_listed": ld.isoformat() if ld else None,
            "etf_units": to_num(_g(r, "發行單位數/轉換數")),
            "etf_name": str(_g(r, "基金簡稱") or "").strip(),
            "etf_manager": str(_g(r, "基金經理人") or "").strip(),
            "etf_benchmark": str(_g(r, "績效指標中文名稱") or "").strip(),
            "etf_custom_index": str(_g(r, "標的指數是否為客製化或需揭露相關資訊之指數") or "").strip(),
            "etf_mix": str(_g(r, "股票及債券投資比例說明") or "").strip(),
            "etf_founded": _roc(_g(r, "成立日期")),
        })
    return pd.DataFrame.from_records(recs)


def parse_revenue(rows, market: str) -> pd.DataFrame:
    """月營收（最新一期）。OpenAPI 單位是千元，這裡換算成元，與 FinMind 一致。"""
    recs = []
    for r in rows or []:
        code = clean_code(r.get("公司代號"))
        if security_type(code) != "stock":
            continue
        ym = str(r.get("資料年月", "")).strip()
        if len(ym) < 4:
            continue
        year, month = int(ym[:-2]) + 1911, int(ym[-2:])
        rev = to_num(r.get("營業收入-當月營收"))
        recs.append({"code": code, "year": year, "month": month,
                     "revenue": rev * 1000 if rev == rev else rev, "source": f"openapi_{market.lower()}"})
    return pd.DataFrame.from_records(recs)


def parse_income_periods(rows) -> pd.DataFrame:
    """季報（綜合損益表）最新一季：只取「誰已公布哪一季」用來決定要向 FinMind 補抓誰。"""
    recs = []
    for r in rows or []:
        code = clean_code(_g(r, "公司代號", "SecuritiesCompanyCode"))
        if security_type(code) != "stock":
            continue
        y = to_num(_g(r, "年度", "Year"))
        q = to_num(_g(r, "季別", "Season"))
        if y == y and q == q:
            recs.append({"code": code, "year": int(y) + 1911, "quarter": int(q)})
    return pd.DataFrame.from_records(recs)


def parse_tpex_qfii(rows) -> pd.DataFrame:
    """櫃買外資持股（OpenAPI 只有最新一天）。"""
    recs = []
    for r in rows or []:
        code = clean_code(r.get("SecuritiesCompanyCode"))
        if security_type(code) is None:
            continue
        d = roc_to_date(r.get("Date"))
        recs.append({"date": pd.Timestamp(d), "code": code, "market": "TPEX",
                     "shares_issued": to_num(r.get("NumberOfSharesIssued")),
                     "foreign_shares": to_num(r.get("CurrentlySharesOC/FIHeld")),
                     "foreign_ratio": to_num(r.get("PercentageOfSharesOC/FMIHeld"))})
    return pd.DataFrame.from_records(recs)


def parse_holidays(rows) -> set:
    out = set()
    for r in rows or []:
        d = roc_to_date(r.get("Date"))
        if d:
            out.add(d)
    return out


_CONF_DATE = re.compile(r"召開法人說明會之日期[:：]\s*(\d{2,3})/(\d{1,2})/(\d{1,2})")
_CONF_TIME = re.compile(r"召開法人說明會之時間[:：]\s*(\d{1,2})\s*時\s*(\d{1,2})?")


def parse_events(rows, market: str, body_max: int = 1500) -> pd.DataFrame:
    """每日重大訊息。第 12 款＝法人說明會：從說明文字解析開會日期與時間（多日行程取第一天）。
    欄位名稱上市／上櫃不同，且上市的「主旨」key 有尾端空白。"""
    recs = []
    for r in rows or []:
        code = clean_code(_g(r, "公司代號", "SecuritiesCompanyCode"))
        if security_type(code) != "stock":
            continue
        spoke = roc_to_date(_g(r, "發言日期"))
        if spoke is None:
            continue
        subject = re.sub(r"\s+", " ", str(_g(r, "主旨 ", "主旨") or "")).strip()
        clause_m = re.search(r"(\d+)", str(_g(r, "符合條款") or ""))
        clause = int(clause_m.group(1)) if clause_m else None
        body = str(_g(r, "說明") or "").replace("\r", "").strip()
        fact = None
        try:
            fact = roc_to_date(_g(r, "事實發生日"))
        except ValueError:
            pass
        conf_date = conf_time = None
        if clause == 12:
            m = _CONF_DATE.search(body)
            if m:
                y, mo, d = map(int, m.groups())
                try:
                    conf_date = dt.date(y + 1911, mo, d)
                except ValueError:
                    conf_date = None
            conf_date = conf_date or fact
            t = _CONF_TIME.search(body)
            if t:
                conf_time = f"{int(t.group(1)):02d}:{int(t.group(2) or 0):02d}"
        recs.append({
            "code": code, "market": market,
            "name": str(_g(r, "公司名稱", "CompanyName") or "").strip(),
            "spoke_date": pd.Timestamp(spoke),
            "spoke_time": str(_g(r, "發言時間") or "").strip().zfill(6),
            "subject": subject, "clause": clause,
            "fact_date": pd.Timestamp(fact) if fact else pd.NaT,
            "is_conf": clause == 12,
            "conf_date": pd.Timestamp(conf_date) if conf_date else pd.NaT,
            "conf_time": conf_time,
            "body": body[:body_max],
        })
    return pd.DataFrame.from_records(recs)
