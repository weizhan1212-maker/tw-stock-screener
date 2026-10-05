"""
資料管線任務：
- daily            每日盤後：抓最近幾個交易日缺的資料＋月營收、季報公布偵測、股票清單
- backfill_daily   歷史回補：證交所＋櫃買日資料（預設 4 年），可續跑、有時間預算
- backfill_finmind 歷史回補：FinMind 財報、月營收、股利（預設 8 年），可續跑、遵守每小時額度
- fin_refresh      季報公布後，向 FinMind 補抓新一季財報
"""
import datetime as dt
import logging
import os
import time

import pandas as pd
import requests

from . import util
from .http import FetchError, Fetcher
from .sources import finmind, openapi, tdcc, tpex, twse
from .store import DataStore

log = logging.getLogger(__name__)

# 證交所、櫃買交錯抓：兩個網站各自限速，交錯可以讓等待時間重疊
DAY_TASKS = ["twse_quotes", "tpex_quotes", "twse_insti", "tpex_insti", "twse_margin", "tpex_margin",
             "twse_valuation", "tpex_valuation", "twse_qfii"]
assert set(DAY_TASKS) == set(twse.PARSERS) | set(tpex.PARSERS)
MAX_TRIES = 3   # 同一天連續失敗幾次後放棄（標記 missing），避免回補無限重試
PARSERS = {**twse.PARSERS, **tpex.PARSERS}
DONE = {"ok", "missing", "holiday"}


# ---------------- 共用 ----------------

def _append(frames: dict, parsed: dict):
    for name, df in parsed.items():
        if df is not None and not df.empty:
            frames.setdefault(name, []).append(df)


def flush(store: DataStore, frames: dict) -> dict:
    """把暫存的資料寫入資料集，回傳各資料集寫入筆數。"""
    counts = {}
    for name, parts in frames.items():
        if parts:
            df = pd.concat(parts, ignore_index=True)
            counts[name] = store.upsert_daily(name, df)
    frames.clear()
    return counts


def day_complete(st: dict | str | None) -> bool:
    if st == "holiday":
        return True
    if not isinstance(st, dict):
        return False
    return all(st.get(t) in DONE for t in DAY_TASKS)


def fetch_day(fetcher: Fetcher, d: dt.date, prev: dict | None, is_today: bool, holidays: set) -> tuple:
    """
    抓一個日期的全部端點。回傳 (狀態, 解析後資料)。
    狀態：'holiday'，或 {任務: 'ok'|'pending'|'missing'|'error:...'}；
    已經 ok 的任務不重抓。
    """
    prev = prev if isinstance(prev, dict) else {}
    frames: dict = {}
    status = dict(prev)
    reqs = {**twse.requests_for(d), **tpex.requests_for(d)}

    # 先抓證交所行情，判斷是不是交易日
    if prev.get("twse_quotes") != "ok":
        url, params = reqs["twse_quotes"]
        try:
            body = fetcher.get_json(url, params)
        except FetchError as e:
            tries = int(prev.get("_tries", 0)) + 1
            status["_tries"] = tries
            status["twse_quotes"] = f"error:{e}"[:200]
            if tries >= MAX_TRIES:
                status = {t: "missing" for t in DAY_TASKS} | {"_tries": tries}
            return status, frames
        parsed = twse.parse_quotes(body, d)
        if not parsed or parsed["prices"].empty:
            if d in holidays or (not is_today and d.weekday() >= 5):
                return "holiday", frames
            if is_today:
                status["twse_quotes"] = "pending"      # 今天可能還沒公布
                return status, frames
            return "holiday", frames                   # 過去的平日沒有資料：休市（含颱風假）
        _append(frames, parsed)
        status["twse_quotes"] = "ok"

    for task in DAY_TASKS:
        if task == "twse_quotes" or status.get(task) in DONE:
            continue
        url, params = reqs[task]
        try:
            body = fetcher.get_json(url, params)
            parsed = PARSERS[task](body, d)
        except (FetchError, ValueError) as e:
            tries = int(prev.get("_tries", 0)) + 1
            status["_tries"] = tries
            status[task] = "missing" if tries >= MAX_TRIES else f"error:{e}"[:200]
            log.warning("%s %s 失敗（第 %d 次）：%s", d, task, tries, e)
            continue
        if parsed and any(not x.empty for x in parsed.values()):
            _append(frames, parsed)
            status[task] = "ok"
        else:
            # 證交所當天有行情、但這個端點沒資料：今天先等，過去的日期重試 2 次後放棄
            if is_today:
                status[task] = "pending"
            else:
                status[task] = "missing" if prev.get(task) == "nodata1" else "nodata1"
    return status, frames


def derive_tpex_exright(store: DataStore, start: pd.Timestamp, end: pd.Timestamp) -> int:
    prices = store.read_daily("prices", start - pd.Timedelta(days=14), end)
    if prices.empty:
        return 0
    ev = tpex.derive_exright(prices)
    ev = ev[(ev["date"] >= start) & (ev["date"] <= end)] if not ev.empty else ev
    return store.upsert_daily("exright", ev)


def fetch_twse_exright(fetcher: Fetcher, store: DataStore, start: dt.date, end: dt.date) -> int:
    url, params = twse.exright_request(start, end)
    body = fetcher.get_json(url, params)
    return store.upsert_daily("exright", twse.parse_exright(body))


def summary(text: str):
    """寫到 GitHub Actions 的執行摘要（本機執行就印出來）。"""
    log.info(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(text + "\n")


def redispatch(workflow: str, inputs: dict) -> bool:
    """在 GitHub Actions 中重新觸發同一個 workflow（回補一次跑不完時接力）。"""
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        return False
    r = requests.post(f"https://api.github.com/repos/{repo}/actions/workflows/{workflow}/dispatches",
                      headers={"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json"},
                      json={"ref": os.environ.get("GITHUB_REF_NAME", "main"), "inputs": inputs}, timeout=30)
    ok = r.status_code == 204
    log.info("重新觸發 %s：%s %s", workflow, r.status_code, "" if ok else r.text[:200])
    return ok


def _holidays(fetcher: Fetcher) -> set:
    try:
        return openapi.parse_holidays(fetcher.get_json(openapi.URLS["twse_holiday"]))
    except FetchError as e:
        log.warning("休市日抓取失敗：%s", e)
        return set()


# ---------------- 每日任務 ----------------

def run_daily(store: DataStore, fetcher: Fetcher, lookback_days: int = 10, today: dt.date | None = None):
    today = today or util.today_tw()
    holidays = _holidays(fetcher)
    state = store.get_state("days", {})
    frames: dict = {}
    touched = []
    for i in range(lookback_days, -1, -1):
        d = today - dt.timedelta(days=i)
        key = d.isoformat()
        if d.weekday() >= 5 or day_complete(state.get(key)):
            continue
        st, fr = fetch_day(fetcher, d, state.get(key), d == today, holidays)
        state[key] = st
        if fr:
            for k, v in fr.items():
                frames.setdefault(k, []).extend(v)
            touched.append(d)
        log.info("%s → %s", key, st)
    counts = flush(store, frames)
    store.put_state("days", state)

    if touched:
        lo, hi = min(touched), max(touched)
        try:
            counts["exright_twse"] = fetch_twse_exright(fetcher, store, lo - dt.timedelta(days=7), hi)
        except FetchError as e:
            log.warning("證交所除權息抓取失敗：%s", e)
        counts["exright_tpex"] = derive_tpex_exright(store, pd.Timestamp(lo) - pd.Timedelta(days=7), pd.Timestamp(hi))

    counts.update(refresh_reference(store, fetcher))
    # 市場總覽／排行榜補充資料（法人金額、當沖、借券、鉅額、期貨、櫃買指數）
    from .market import run_extras
    complete = [today - dt.timedelta(days=i) for i in range(lookback_days, -1, -1)
                if isinstance(state.get((today - dt.timedelta(days=i)).isoformat()), dict)
                and day_complete(state[(today - dt.timedelta(days=i)).isoformat()])]
    counts.update({f"extras_{k}": v for k, v in run_extras(store, fetcher, complete).items()})
    lines = [f"## 每日任務 {today}", "", "| 日期 | 狀態 |", "|---|---|"]
    for i in range(lookback_days, -1, -1):
        k = (today - dt.timedelta(days=i)).isoformat()
        if k in state:
            s = state[k]
            lines.append(f"| {k} | {'休市' if s == 'holiday' else ('完成' if day_complete(s) else s)} |")
    lines += ["", "寫入筆數：" + ", ".join(f"{k}={v}" for k, v in counts.items())]
    summary("\n".join(lines))
    return counts


def refresh_reference(store: DataStore, fetcher: Fetcher) -> dict:
    """月營收（最新一期）、季報公布偵測、櫃買外資持股、股票清單、下市清單。每項失敗都不影響其他項。"""
    counts = {}

    def safe(name, fn):
        try:
            counts[name] = fn()
        except Exception as e:  # noqa: BLE001 — 參考資料失敗不應中斷每日任務
            log.warning("%s 失敗：%s", name, e)
            counts[name] = f"失敗：{e}"[:80]

    def revenue():
        frames = [openapi.parse_revenue(fetcher.get_json(openapi.URLS[f"{m}_revenue"]), m.upper())
                  for m in ("twse", "tpex")]
        return store.upsert_table("revenue_latest", pd.concat(frames, ignore_index=True))

    def income_periods():
        frames = [openapi.parse_income_periods(fetcher.get_json(openapi.URLS[f"{m}_income"])) for m in ("twse", "tpex")]
        df = pd.concat(frames, ignore_index=True)
        n = store.upsert_table("income_periods", df)
        enqueue_fin_refresh(store, df)
        return n

    def tpex_qfii():
        return store.upsert_daily("qfii", openapi.parse_tpex_qfii(fetcher.get_json(openapi.URLS["tpex_qfii"])))

    def securities():
        info = finmind.parse_info(finmind.check(fetcher.get_json(finmind.URL, finmind.params("TaiwanStockInfo"), delay=1)))
        info = info[info["market"].isin(["TWSE", "TPEX"])]
        return store.upsert_table("securities", info, replace=True)

    def company():
        frames = [openapi.parse_company(fetcher.get_json(openapi.URLS[f"{m}_company"]), m.upper()) for m in ("twse", "tpex")]
        return store.upsert_table("company", pd.concat(frames, ignore_index=True), replace=True)

    def delisting():
        d = finmind.parse_delisting(finmind.check(fetcher.get_json(finmind.URL, finmind.params("TaiwanStockDelisting"), delay=1)))
        return store.upsert_table("delisting", d, replace=True)

    def holders():
        return store.upsert_daily("holders", tdcc.parse(fetcher.get_text(tdcc.URL, delay=1)))

    for name, fn in (("holders", holders), ("revenue", revenue), ("income_periods", income_periods), ("qfii_tpex", tpex_qfii),
                     ("securities", securities), ("company", company), ("delisting", delisting)):
        safe(name, fn)
    return counts


def enqueue_fin_refresh(store: DataStore, periods: pd.DataFrame):
    """OpenAPI 顯示已公布新一季、但我們的財報還沒有的公司 → 排進 FinMind 補抓佇列。"""
    if periods.empty:
        return
    inc = store.read_table("income")
    have = {}
    if not inc.empty:
        last = inc.groupby("code")["date"].max()
        have = {c: (d.year, (d.month - 1) // 3 + 1) for c, d in last.items()}
    q = store.get_state("fin_queue", {"codes": []})
    queue = set(q.get("codes", []))
    for r in periods.itertuples():
        if have.get(r.code, (0, 0)) < (r.year, r.quarter):
            queue.add(r.code)
    q["codes"] = sorted(queue)
    store.put_state("fin_queue", q)


# ---------------- 歷史回補：日資料 ----------------

def run_backfill_daily(store: DataStore, fetcher: Fetcher, years: int = 4, budget_min: float = 320,
                       max_days: int | None = None, flush_every: int = 15, today: dt.date | None = None) -> int:
    """回傳剩餘未完成的日期數。由新到舊回補，先有近期資料可用。"""
    t0 = time.monotonic()
    today = today or util.today_tw()
    start = today - dt.timedelta(days=int(365.25 * years) + 7)
    holidays = _holidays(fetcher)
    state = store.get_state("days", {})

    # 證交所除權息：每月一個請求
    ex_state = store.get_state("exright_months", {"done": []})
    done_months = set(ex_state["done"])
    m = dt.date(start.year, start.month, 1)
    while m <= today:
        nxt = (m.replace(day=28) + dt.timedelta(days=4)).replace(day=1)
        key = m.strftime("%Y-%m")
        if key not in done_months or nxt > today - dt.timedelta(days=40):
            try:
                fetch_twse_exright(fetcher, store, m, min(nxt - dt.timedelta(days=1), today))
                done_months.add(key)
            except FetchError as e:
                log.warning("除權息 %s 失敗：%s", key, e)
        m = nxt
    ex_state["done"] = sorted(done_months)
    store.put_state("exright_months", ex_state)

    dates = [start + dt.timedelta(days=i) for i in range((today - start).days)]   # 不含今天
    todo = [d for d in reversed(dates) if d.weekday() < 5 and not day_complete(state.get(d.isoformat()))]
    before = len(todo)
    log.info("待回補 %d 天（%s ~ %s）", len(todo), start, today)
    frames: dict = {}
    processed = 0
    for d in todo:
        if (time.monotonic() - t0) / 60 > budget_min or (max_days and processed >= max_days):
            break
        st, fr = fetch_day(fetcher, d, state.get(d.isoformat()), False, holidays)
        state[d.isoformat()] = st
        for k, v in fr.items():
            frames.setdefault(k, []).extend(v)
        processed += 1
        if processed % flush_every == 0:
            flush(store, frames)
            store.put_state("days", state)
            log.info("已處理 %d / %d 天，耗時 %.1f 分", processed, len(todo), (time.monotonic() - t0) / 60)
    flush(store, frames)
    store.put_state("days", state)

    remaining = sum(1 for d in dates if d.weekday() < 5 and not day_complete(state.get(d.isoformat())))
    if remaining == 0:
        derive_tpex_exright(store, pd.Timestamp(start), pd.Timestamp(today))
    summary(f"## 日資料回補\n\n本次處理 {processed} 天，剩餘 {remaining} 天，請求 {fetcher.count} 次，"
            f"耗時 {(time.monotonic() - t0) / 60:.1f} 分鐘")
    return before, remaining


# ---------------- 歷史回補：FinMind ----------------

def _fm_fetch(fetcher: Fetcher, kind: str, code: str, start: str) -> pd.DataFrame:
    body = fetcher.get_json(finmind.URL, finmind.params(finmind.DATASETS[kind], code, start),
                            delay=3600 / finmind.per_hour_limit() * 1.05)
    data = finmind.check(body)
    if kind in ("income", "balance", "cashflow"):
        return finmind.parse_statement(data, kind)
    if kind == "revenue":
        return finmind.parse_revenue(data)
    return finmind.parse_dividend(data)


def _sleep_to_next_hour():
    now = time.time()
    wait = 3600 - (now % 3600) + 60
    log.info("FinMind 額度用完，等待 %.0f 秒", wait)
    time.sleep(wait)


def run_backfill_finmind(store: DataStore, fetcher: Fetcher, years: int = 8, budget_min: float = 320,
                         max_codes: int | None = None, flush_every: int = 50,
                         kinds=("income", "balance", "cashflow", "revenue", "dividend"),
                         today: dt.date | None = None) -> int:
    t0 = time.monotonic()
    today = today or util.today_tw()
    start = (today - dt.timedelta(days=int(365.25 * years))).isoformat()
    sec = store.read_table("securities")
    if sec.empty:
        refresh_reference(store, fetcher)
        sec = store.read_table("securities")
    codes = sorted(sec[sec["sec_type"] == "stock"]["code"].unique()) if not sec.empty else []
    # 回測期間內下市的公司也要（避免倖存者偏差）
    dl = store.read_table("delisting")
    if not dl.empty:
        cutoff = pd.Timestamp(today - dt.timedelta(days=int(365.25 * 4) + 30))
        extra = dl[(dl["delisted_date"] >= cutoff) & (dl["code"].str.fullmatch(r"[1-9]\d{3}"))]["code"]
        codes = sorted(set(codes) | set(extra))

    state = store.get_state("finmind_backfill", {})
    state.pop("_complete", None)
    todo = [c for c in codes if not all(k in state.get(c, []) for k in kinds)]
    before = len(todo)
    log.info("FinMind 待回補 %d 檔（共 %d 檔），每小時上限 %d 次", len(todo), len(codes), finmind.per_hour_limit())
    buf: dict = {k: [] for k in kinds}
    processed = 0

    def do_flush():
        for k, parts in buf.items():
            if parts:
                store.upsert_table(k, pd.concat(parts, ignore_index=True))
                parts.clear()
        store.put_state("finmind_backfill", state)

    for code in todo:
        if (time.monotonic() - t0) / 60 > budget_min or (max_codes and processed >= max_codes):
            break
        done = set(state.get(code, []))
        for k in kinds:
            if k in done:
                continue
            for attempt in range(2):
                try:
                    df = _fm_fetch(fetcher, k, code, start)
                    if not df.empty:
                        buf[k].append(df)
                    done.add(k)
                    break
                except finmind.RateLimited:
                    if (time.monotonic() - t0) / 60 + 62 > budget_min:
                        state[code] = sorted(done)
                        do_flush()
                        return before, before - processed
                    _sleep_to_next_hour()
                except (FetchError, ValueError) as e:
                    log.warning("FinMind %s %s 失敗：%s", code, k, e)
                    break
        state[code] = sorted(done)
        processed += 1
        if processed % flush_every == 0:
            do_flush()
            log.info("FinMind 已處理 %d / %d 檔，耗時 %.1f 分", processed, len(todo), (time.monotonic() - t0) / 60)
    remaining = sum(1 for c in codes if not all(k in state.get(c, []) for k in kinds))
    state["_complete"] = remaining == 0
    do_flush()
    summary(f"## FinMind 回補\n\n本次處理 {processed} 檔，剩餘 {remaining} 檔，請求 {fetcher.count} 次，"
            f"耗時 {(time.monotonic() - t0) / 60:.1f} 分鐘")
    return before, remaining


# ---------------- 季報補抓 ----------------

def _latest_quarters(store: DataStore) -> dict:
    inc = store.read_table("income")
    if inc.empty:
        return {}
    last = inc.groupby("code")["date"].max()
    return {c: (d.year, (d.month - 1) // 3 + 1) for c, d in last.items()}


def _still_needed(store: DataStore, codes) -> list:
    """佇列中已經有最新一季財報的公司就不用再抓（回補期間累積的佇列會在這裡被清掉）。"""
    per = store.read_table("income_periods")
    if per.empty:
        return list(codes)
    published = per.groupby("code").apply(lambda g: max(zip(g["year"], g["quarter"]))).to_dict()
    have = _latest_quarters(store)
    return [c for c in codes if have.get(c, (0, 0)) < published.get(c, (0, 0))]

def run_fin_refresh(store: DataStore, fetcher: Fetcher, budget_min: float = 40) -> int:
    t0 = time.monotonic()
    if not store.get_state("finmind_backfill", {}).get("_complete"):
        summary("## 季報補抓\n\nFinMind 歷史回補尚未完成，先跳過（避免兩個任務同時寫入財報檔）")
        return -1
    q = store.get_state("fin_queue", {"codes": []})
    queue = _still_needed(store, q.get("codes", []))
    start = (util.today_tw() - dt.timedelta(days=400)).isoformat()
    kinds = ("income", "balance", "cashflow", "dividend")
    buf: dict = {k: [] for k in kinds}
    done_codes = []
    for code in queue:
        if (time.monotonic() - t0) / 60 > budget_min:
            break
        try:
            for k in kinds:
                df = _fm_fetch(fetcher, k, code, start)
                if not df.empty:
                    buf[k].append(df)
            done_codes.append(code)
        except finmind.RateLimited:
            break
        except (FetchError, ValueError) as e:
            log.warning("季報補抓 %s 失敗：%s", code, e)
    for k, parts in buf.items():
        if parts:
            store.upsert_table(k, pd.concat(parts, ignore_index=True))
    q["codes"] = [c for c in queue if c not in set(done_codes)]
    store.put_state("fin_queue", q)
    summary(f"## 季報補抓\n\n完成 {len(done_codes)} 檔，佇列剩 {len(q['codes'])} 檔")
    return len(q["codes"])
