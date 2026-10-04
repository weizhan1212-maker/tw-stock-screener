import datetime as dt

import pandas as pd

from pipeline import jobs
from pipeline.storage import LocalStorage
from pipeline.store import DataStore


def make_store(tmp_path):
    return DataStore(LocalStorage(str(tmp_path)))


def test_store_upsert_idempotent(tmp_path):
    s = make_store(tmp_path)
    df = pd.DataFrame({"date": pd.to_datetime(["2026-09-30", "2026-10-01"]), "code": ["2330", "2330"],
                       "market": "TWSE", "close": [1.0, 2.0]})
    s.upsert_daily("prices", df)
    s.upsert_daily("prices", df.assign(close=[1.5, 2.5]))     # 重跑：新值覆蓋、不重複
    out = s.read_daily("prices")
    assert len(out) == 2 and list(out["close"]) == [1.5, 2.5]
    assert s.months("prices") == ["2026-09", "2026-10"]
    assert len(s.read_daily("prices", start="2026-10-01")) == 1


def test_fetch_day_trading(fake):
    st, frames = jobs.fetch_day(fake, dt.date(2026, 10, 2), None, False, set())
    assert jobs.day_complete(st), st
    for name in ("prices", "insti", "margin", "valuation", "qfii", "index"):
        assert name in frames and frames[name], name
    prices = pd.concat(frames["prices"])
    assert set(prices["market"]) == {"TWSE", "TPEX"}


def test_fetch_day_weekday_without_data_is_holiday(fake):
    st, frames = jobs.fetch_day(fake, dt.date(2026, 9, 30), None, False, set())
    assert st == "holiday" and not frames


def test_fetch_day_today_pending(fake):
    st, _ = jobs.fetch_day(fake, dt.date(2026, 9, 30), None, True, set())
    assert st == {"twse_quotes": "pending"}


def test_fetch_day_skips_done_tasks(fake):
    prev = {t: "ok" for t in jobs.DAY_TASKS}
    prev["tpex_margin"] = "error:timeout"
    st, frames = jobs.fetch_day(fake, dt.date(2026, 10, 2), prev, False, set())
    assert jobs.day_complete(st)
    assert len(fake.calls) == 1 and "balance" in fake.calls[0][0]
    assert list(frames) == ["margin"]


def test_run_daily(fake, tmp_path):
    s = make_store(tmp_path)
    counts = jobs.run_daily(s, fake, lookback_days=3, today=dt.date(2026, 10, 2))
    state = s.get_state("days")
    assert jobs.day_complete(state["2026-10-02"])
    assert state["2026-09-30"] == "holiday"            # 樣本沒有這天 → 視為休市
    assert counts["prices"] > 0 and counts["exright_twse"] > 0
    assert not s.read_table("revenue_latest").empty
    assert not s.read_table("securities").empty
    assert not s.read_table("income_periods").empty
    # 再跑一次：已完成的日期不重抓
    fake.calls.clear()
    jobs.run_daily(s, fake, lookback_days=3, today=dt.date(2026, 10, 2))
    assert not any("MI_INDEX" in u for u, _ in fake.calls)


def test_backfill_daily_resumes(fake, tmp_path):
    s = make_store(tmp_path)
    left1 = jobs.run_backfill_daily(s, fake, years=0.02, max_days=2, today=dt.date(2026, 10, 3))
    left2 = jobs.run_backfill_daily(s, fake, years=0.02, today=dt.date(2026, 10, 3))
    assert left2 == 0 and left1 > left2
    assert jobs.day_complete(s.get_state("days")["2026-10-02"])


def test_backfill_finmind(fake, tmp_path, monkeypatch):
    s = make_store(tmp_path)
    s.upsert_table("securities", pd.DataFrame({"code": ["2330", "0050"], "name": ["台積電", "元大台灣50"],
                                               "industry": ["半導體業", ""], "market": ["TWSE", "TWSE"],
                                               "sec_type": ["stock", "etf"]}))
    monkeypatch.setattr(jobs.time, "sleep", lambda *_: None)
    left = jobs.run_backfill_finmind(s, fake, today=dt.date(2026, 10, 4))
    assert left == 0 and s.get_state("finmind_backfill")["_complete"] is True
    assert not s.read_table("income").empty and not s.read_table("dividend").empty
    datasets = {p["dataset"] for _, p in fake.calls if "dataset" in p}
    assert "TaiwanStockPriceAdj" not in datasets
    # 只抓普通股，不抓 ETF 的財報
    assert all(p.get("data_id") != "0050" for _, p in fake.calls)


def test_fin_refresh_waits_for_backfill(fake, tmp_path):
    s = make_store(tmp_path)
    s.put_state("fin_queue", {"codes": ["2330"]})
    assert jobs.run_fin_refresh(s, fake) == -1 and not fake.calls
    s.put_state("finmind_backfill", {"_complete": True})
    assert jobs.run_fin_refresh(s, fake) == 0
    assert not s.read_table("income").empty


def test_supabase_url_normalized():
    from pipeline.storage import SupabaseStorage
    for u in ("https://abc.supabase.co", "https://abc.supabase.co/", "https://abc.supabase.co/rest/v1/", "abc.supabase.co"):
        assert SupabaseStorage(u, "sb_secret_x").base == "https://abc.supabase.co/storage/v1"
