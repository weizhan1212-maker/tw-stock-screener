"""共用小工具：數字解析、民國日期轉換、股票代號分類。"""
import datetime as dt
import math
import re

TW = dt.timezone(dt.timedelta(hours=8))

_STOCK_RE = re.compile(r"[1-9]\d{3}")          # 普通股：4 位數，不以 0 開頭（例：2330、9958）
_ETF_RE = re.compile(r"00\d{2,4}[A-Z]?")       # ETF：00 開頭（例：0050、00878、006208、00679B、00981A）
_EMPTY = {"", "-", "--", "---", "----", "X", "x", "N/A", "NA", "除權", "除息", "除權息"}


def now_tw() -> dt.datetime:
    return dt.datetime.now(TW)


def today_tw() -> dt.date:
    return now_tw().date()


def to_num(x):
    """把 '1,234'、'-5.6 '、'12.3%'、'--' 等字串轉成 float；無法解析回傳 NaN。"""
    if x is None:
        return math.nan
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", "").replace("%", "").replace("+", "")
    if s in _EMPTY:
        return math.nan
    try:
        return float(s)
    except ValueError:
        return math.nan


def clean_code(x) -> str:
    return str(x).strip().replace("　", "")


def clean_name(x) -> str:
    return str(x).strip().replace("　", "")


def security_type(code: str):
    """回傳 'stock'、'etf'，或 None（不納入：權證、特別股、ETN、TDR、受益證券等）。"""
    if _STOCK_RE.fullmatch(code):
        return "stock"
    if _ETF_RE.fullmatch(code):
        return "etf"
    return None


def roc_to_date(s) -> dt.date | None:
    """民國日期轉西元：'111年01月12日'、'111/01/03'、'1151002'、'115/04/10' 都可以。"""
    if s is None:
        return None
    t = str(s).strip()
    m = re.fullmatch(r"(\d{2,3})\D(\d{1,2})\D(\d{1,2})\D?", t)
    if m:
        y, mo, d = map(int, m.groups())
        return dt.date(y + 1911, mo, d)
    m = re.fullmatch(r"(\d{2,3})(\d{2})(\d{2})", t)
    if m:
        y, mo, d = map(int, m.groups())
        return dt.date(y + 1911, mo, d)
    return None


def ymd_to_date(s) -> dt.date | None:
    """'20261002' → date"""
    t = str(s).strip()
    if re.fullmatch(r"\d{8}", t):
        return dt.date(int(t[:4]), int(t[4:6]), int(t[6:]))
    return None


def norm_field(f: str) -> str:
    """欄位名稱正規化：去空白（櫃買欄位常有 '次日 參考價' 這種空格）。"""
    return re.sub(r"\s+", "", str(f))


def field_index(fields, *candidates, startswith=False):
    """在欄位清單中找第一個符合的欄位位置；找不到回傳 None。"""
    nf = [norm_field(f) for f in fields]
    for c in candidates:
        c = norm_field(c)
        for i, f in enumerate(nf):
            if f == c or (startswith and f.startswith(c)):
                return i
    return None


# ---------------- 產業分類 ----------------
# 證交所／櫃買中心公司基本資料的「產業別」代碼（官方主要產業，一家公司只有一個）
INDUSTRY_NAMES = {
    "01": "水泥工業", "02": "食品工業", "03": "塑膠工業", "04": "紡織纖維", "05": "電機機械", "06": "電器電纜",
    "08": "玻璃陶瓷", "09": "造紙工業", "10": "鋼鐵工業", "11": "橡膠工業", "12": "汽車工業", "14": "建材營造",
    "15": "航運業", "16": "觀光餐旅", "17": "金融保險", "18": "貿易百貨", "19": "綜合", "20": "其他",
    "21": "化學工業", "22": "生技醫療業", "23": "油電燃氣業", "24": "半導體業", "25": "電腦及週邊設備業",
    "26": "光電業", "27": "通信網路業", "28": "電子零組件業", "29": "電子通路業", "30": "資訊服務業",
    "31": "其他電子業", "32": "文化創意業", "33": "農業科技業", "34": "電子商務", "35": "綠能環保",
    "36": "數位雲端", "37": "運動休閒", "38": "居家生活",
}
_IND_ALIAS = {"其他電子類": "其他電子業", "觀光事業": "觀光餐旅", "金融業": "金融保險", "電子商務業": "電子商務",
              "綠能環保類": "綠能環保", "數位雲端類": "數位雲端", "運動休閒類": "運動休閒", "居家生活類": "居家生活"}
_IND_UMBRELLA = {"電子工業", "化學生技醫療", "創新版股票", "創新板股票", "存託憑證"}
_IND_THEME = {"綠能環保", "數位雲端", "運動休閒", "居家生活", "其他"}


def main_industry(code, raw) -> str | None:
    """主要產業：優先用官方產業別代碼；沒有時從 FinMind 的多重分類字串挑一個。"""
    c = str(code or "").strip()
    if c.isdigit():
        name = INDUSTRY_NAMES.get(c.zfill(2))
        if name:
            return name
    if not isinstance(raw, str) or not raw.strip():
        return None
    parts = [_IND_ALIAS.get(p.strip(), p.strip()) for p in raw.split("、") if p.strip()]
    parts = [p for p in dict.fromkeys(parts) if p not in _IND_UMBRELLA and "ETF" not in p and "指數股票型" not in p]
    if not parts:
        return None
    core = [p for p in parts if p not in _IND_THEME]
    return (core or parts)[0]
