"""ETF 資料：
- 淨值與折溢價：證交所基本市況報導網站（mis.twse.com.tw）的 ETF 淨值表，含上市與上櫃所有 ETF。
  欄位：a 代號、b 名稱、c 已發行單位數、d 單位數增減、e 市價、f 投信預估淨值、g 預估折溢價（%）、h 前一營業日淨值、i 資料日、j 時間。
- 成分股：投信投顧公會（SITCA）「基金投資明細－月前十大」，每月公布各基金前十大持股（資料來源為各投信）。
  只抓國內股票型 ETF（指數型 AH11、主動式 AL11）。公會頁面只有基金全名，代號用證交所基金基本資料對應。
"""
import datetime as dt
import re

import pandas as pd

from ..util import clean_code, to_num

NAV_URL = "https://mis.twse.com.tw/stock/data/all_etf.txt"
SITCA_TOP10 = "https://www.sitca.org.tw/ROC/Industry/IN2629.aspx?pid=IN22601_04"
SITCA_CLASSES = {"AH11": "國內指數股票型（股票）", "AL11": "國內主動式 ETF（股票）"}


def _num(v):
    if v in (None, "", "-", "--"):
        return None
    return to_num(v)


def parse_nav(body) -> pd.DataFrame:
    recs = []
    for g in (body or {}).get("a1", []) or []:
        for x in g.get("msgArray", []) or []:
            code = clean_code(x.get("a"))
            d = str(x.get("i") or "")
            if not code or not re.fullmatch(r"\d{8}", d):
                continue
            recs.append({
                "date": pd.Timestamp(dt.date(int(d[:4]), int(d[4:6]), int(d[6:]))), "code": code,
                "units": _num(x.get("c")), "units_chg": _num(x.get("d")),
                "price": _num(x.get("e")), "nav": _num(x.get("f")), "premium": _num(x.get("g")),
                "nav_prev": _num(x.get("h")),
            })
    df = pd.DataFrame.from_records(recs)
    return df.drop_duplicates(["date", "code"], keep="last") if not df.empty else df


# ---------------- SITCA 月前十大 ----------------

_HIDDEN = re.compile(r'<input[^>]+type="hidden"[^>]+name="([^"]+)"[^>]*value="([^"]*)"', re.I)


def sitca_form(html: str) -> dict:
    """取出 ASP.NET 表單的隱藏欄位（__VIEWSTATE 等），送出查詢時要一起帶上。"""
    import html as h
    return {k: h.unescape(v) for k, v in _HIDDEN.findall(html)}


def sitca_months(html: str) -> list[str]:
    m = re.search(r'name="ctl00\$ContentPlaceHolder1\$ddlQ_YM".*?</select>', html, re.S)
    return re.findall(r'value="(\d{6})"', m.group(0)) if m else []


def sitca_payload(hidden: dict, ym: str, cls: str) -> dict:
    p = dict(hidden)
    p.update({
        "__EVENTTARGET": "", "__EVENTARGUMENT": "",
        "ctl00$ContentPlaceHolder1$ddlQ_YM": ym,
        "ctl00$ContentPlaceHolder1$rdo1": "rbClass",
        "ctl00$ContentPlaceHolder1$ddlQ_Class": cls,
        "ctl00$ContentPlaceHolder1$BtnQuery": "查詢",
    })
    return p


def table_rows(html: str) -> list[list[str]]:
    """把 HTML 裡所有表格列拆成文字（巢狀表格也可以：文字歸到最內層那一列）。"""
    from html.parser import HTMLParser

    class P(HTMLParser):
        def __init__(self):
            super().__init__(convert_charrefs=True)
            self.stack, self.rows = [], []

        def handle_starttag(self, tag, attrs):
            if tag == "tr":
                self.stack.append([])
            elif tag in ("td", "th") and self.stack:
                self.stack[-1].append("")

        def handle_endtag(self, tag):
            if tag == "tr" and self.stack:
                row = [c.strip() for c in self.stack.pop()]
                if row:
                    self.rows.append(row)

        def handle_data(self, data):
            if self.stack and self.stack[-1]:
                self.stack[-1][-1] += data

    p = P()
    p.feed(html)
    return p.rows


def parse_top10(html: str, ym: str, cls: str) -> pd.DataFrame:
    """每檔基金 10 列：第一列多一格基金名稱（跨列），之後各列從名次開始。欄位：名次、標的種類、代號、名稱、金額、擔保機構、次順位債券、受益權單位數、占淨值比例。"""
    recs, fund = [], None
    for c in table_rows(html):
        c = [re.sub(r"\s+", " ", x) for x in c]
        if len(c) >= 10 and re.fullmatch(r"\d{1,2}", c[1]):
            fund, c = c[0], c[1:]
        if fund is None or len(c) < 9 or not re.fullmatch(r"\d{1,2}", c[0]):
            continue
        rank, kind, code, name, amount, _, _, _, pct = c[:9]
        code = code.replace(" ", "")
        recs.append({
            "ym": ym, "cls": cls, "fund": fund, "rank": int(rank), "kind": kind,
            "code": clean_code(code) if re.fullmatch(r"[0-9A-Z]{4,6}", code) else code,
            "name": name, "amount": _num(amount), "pct": _num(pct),
        })
    return pd.DataFrame.from_records(recs)


# ---------------- 基金名稱 → 代號 ----------------

_STRIP = re.compile(r"[（(][^）)]*[）)]|\s|證券投資信託基金|證券投資信託|指數股票型基金|交易所交易基金|基金|傘型|之|子|ETF|主動式|主動")
# 名稱完全對不起來的少數基金（已用證交所淨值表核對代號）
MANUAL = {"富邦台灣富邦台灣摩根": "0057"}


def norm_name(s: str) -> str:
    import unicodedata
    return _STRIP.sub("", unicodedata.normalize("NFKC", str(s or ""))).replace("臺", "台").upper()


def _subseq(a: str, b: str) -> bool:
    """a 的每個字依序出現在 b 裡（例：「中信上櫃ESG30」在「中國信託上櫃ESG30」裡）。"""
    it = iter(b)
    return all(ch in it for ch in a)


def map_funds(funds, etf_info: pd.DataFrame, nav_names: dict) -> dict:
    """基金全名對應代號：先比證交所基本資料的全名，再比淨值表的簡稱（包含、依序出現），最後查手動對照。
    多個候選時不猜，略過。回傳 {基金名稱: 代號}。"""
    full = {}
    if not etf_info.empty and "etf_fullname" in etf_info:
        full = {norm_name(r.etf_fullname): r.code for r in etf_info.itertuples() if r.etf_fullname}
    short = [(norm_name(n), c) for c, n in nav_names.items() if len(norm_name(n)) >= 4]
    out = {}
    for f in funds:
        k = norm_name(f)
        code = full.get(k) or MANUAL.get(k)
        if code is None:
            hits = {c for n, c in short if n in k or k in n}
            if len(hits) != 1:
                hits = {c for n, c in short if _subseq(n, k)}
            code = next(iter(hits)) if len(hits) == 1 else None
        if code:
            out[f] = code
    return out
