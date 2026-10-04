"""證交所／櫃買 OpenAPI：公司基本資料、月營收（最新一期）、季報公布偵測、櫃買外資持股（最新）。"""
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
