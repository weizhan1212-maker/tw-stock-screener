"""資料檢查報告：各資料集筆數、日期範圍、每日檔數、缺值比例、回補進度，以及台積電抽樣。"""
import logging

import pandas as pd

from .jobs import DAY_TASKS, day_complete, summary
from .store import DAILY_KEYS, TABLE_KEYS, DataStore

log = logging.getLogger(__name__)

KEY_COLS = {"prices": ["close", "volume"], "insti": ["foreign", "trust", "dealer"],
            "margin": ["margin_balance", "short_balance"], "valuation": ["pe", "pb", "dividend_yield"],
            "qfii": ["foreign_ratio"], "index": ["taiex", "taiex_tr"], "exright": ["prev_close", "ref_price"]}


def run_report(store: DataStore):
    lines = ["## 資料檢查報告", "", "### 日資料", "",
             "| 資料集 | 月份數 | 近 3 個月筆數 | 近 3 個月日期範圍 | 近 20 日每日檔數（最少/中位/最多） | 缺值比例 |",
             "|---|---|---|---|---|---|"]
    recent_start = pd.Timestamp.today() - pd.Timedelta(days=95)      # 只讀近 3 個月（省傳輸量）
    for name in DAILY_KEYS:
        df = store.read_daily(name, recent_start)
        if df.empty:
            lines.append(f"| {name} | 0 | 0 | — | — | — |")
            continue
        per_day = df.groupby("date").size()
        recent = per_day.tail(20)
        nulls = ", ".join(f"{c}={df[c].isna().mean():.1%}" for c in KEY_COLS.get(name, []) if c in df)
        lines.append(f"| {name} | {len(store.months(name))} | {len(df):,} | {df['date'].min():%Y-%m-%d} ~ "
                     f"{df['date'].max():%Y-%m-%d} | {recent.min()}/{int(recent.median())}/{recent.max()} | {nulls} |")
    lines += ["", "### 其他表", "", "| 表 | 筆數 | 檔數 |", "|---|---|---|"]
    for name in TABLE_KEYS:
        df = store.read_table(name)
        n_codes = df["code"].nunique() if "code" in df else ""
        lines.append(f"| {name} | {len(df):,} | {n_codes} |")

    days = store.get_state("days", {})
    done = sum(1 for v in days.values() if day_complete(v) and v != "holiday")
    hol = sum(1 for v in days.values() if v == "holiday")
    bad = {k: v for k, v in days.items() if not day_complete(v)}
    missing = sum(1 for v in days.values() if isinstance(v, dict) and any(v.get(t) == "missing" for t in DAY_TASKS))
    fm = store.get_state("finmind_backfill", {})
    fm_done = sum(1 for k, v in fm.items() if not k.startswith("_") and len(v) >= 5)
    lines += ["", "### 回補進度", "",
              f"- 日資料：完成 {done} 個交易日、休市 {hol} 天、未完成 {len(bad)} 天、有缺漏端點 {missing} 天",
              f"- FinMind：完成 {fm_done} 檔（全部完成：{bool(fm.get('_complete'))}）",
              f"- 季報補抓佇列：{len(store.get_state('fin_queue', {}).get('codes', []))} 檔"]
    if bad:
        sample = list(bad.items())[:5]
        lines.append("- 未完成範例：" + "；".join(f"{k}: {v}" for k, v in sample))

    p = store.read_daily("prices", recent_start)
    if not p.empty:
        last = p[p["code"] == "2330"].tail(3)
        lines += ["", "### 抽樣：台積電最近 3 天", "", "```", last.to_string(index=False), "```"]
    summary("\n".join(lines))
