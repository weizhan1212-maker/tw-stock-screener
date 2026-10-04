"""各資料源共用：把「欄位清單＋資料列」轉成 DataFrame。"""
import pandas as pd

from ..util import clean_code, clean_name, field_index, security_type, to_num


def build_frame(fields, rows, date, market, spec, code_field=("證券代號", "代號", "股票代號"),
                name_field=("證券名稱", "名稱", "公司名稱"), positional=None):
    """
    spec: {輸出欄位: (候選欄位名稱...)} 依欄位名稱對應
    positional: {輸出欄位: 位置索引}，用於欄位名稱重複的表（例：融資融券的「買進」出現兩次）
    只保留普通股與 ETF。
    """
    ci = field_index(fields, *code_field)
    ni = field_index(fields, *name_field)
    idx = {}
    for out, cands in spec.items():
        i = field_index(fields, *cands, startswith=True)
        if i is not None:
            idx[out] = i
    if positional:
        idx.update(positional)
    recs = []
    for r in rows or []:
        if not r or ci is None:
            continue
        code = clean_code(r[ci])
        st = security_type(code)
        if st is None:
            continue
        rec = {"date": date, "code": code, "market": market}
        if ni is not None:
            rec["name"] = clean_name(r[ni])
        for out, i in idx.items():
            rec[out] = to_num(r[i]) if i < len(r) else float("nan")
        recs.append(rec)
    df = pd.DataFrame.from_records(recs)
    if not df.empty:
        df["date"] = pd.to_datetime(df["date"])
    return df


def find_table(body, *title_keywords):
    """在 {'tables': [...]} 中找標題包含關鍵字的表；找不到回傳 None。"""
    for t in body.get("tables") or []:
        title = str(t.get("title") or "")
        if all(k in title for k in title_keywords):
            return t
    return None
