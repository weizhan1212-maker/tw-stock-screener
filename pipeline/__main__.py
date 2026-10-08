"""
命令列入口：
    python -m pipeline daily
    python -m pipeline backfill-daily   [--years 4] [--budget-min 320] [--max-days N] [--chain]
    python -m pipeline backfill-finmind [--years 8] [--budget-min 320] [--max-codes N] [--chain]
    python -m pipeline fin-refresh      [--budget-min 40]
    python -m pipeline backtest-data    [--budget-min 40] [--rebuild] [--chain]
--chain：在 GitHub Actions 中，一次跑不完就自動重新觸發同一個 workflow 接力。
"""
import argparse
import logging
import sys

from . import jobs
from .http import Fetcher
from .storage import from_env
from .store import DataStore


def main(argv=None):
    p = argparse.ArgumentParser(prog="pipeline")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("daily").add_argument("--lookback", type=int, default=10)
    b = sub.add_parser("backfill-daily")
    b.add_argument("--years", type=float, default=4)
    b.add_argument("--budget-min", type=float, default=320)
    b.add_argument("--max-days", type=int)
    b.add_argument("--chain", action="store_true")
    f = sub.add_parser("backfill-finmind")
    f.add_argument("--years", type=float, default=8)
    f.add_argument("--budget-min", type=float, default=320)
    f.add_argument("--max-codes", type=int)
    f.add_argument("--chain", action="store_true")
    sub.add_parser("report")
    mu = sub.add_parser("migrate-users")
    mu.add_argument("--mode", choices=["merge", "ignore", "check", "selftest"], default="check")
    sub.add_parser("snapshot")
    sub.add_parser("market")
    sk = sub.add_parser("stocks")
    sk.add_argument("--codes", help="只產生這些代號（逗號分隔），測試用")
    sub.add_parser("backfill-extras").add_argument("--days", type=int, default=70)
    bi = sub.add_parser("backfill-indices")
    bi.add_argument("--years", type=float, default=4)
    bi.add_argument("--budget-min", type=float, default=320)
    r = sub.add_parser("fin-refresh")
    r.add_argument("--budget-min", type=float, default=40)
    bt = sub.add_parser("backtest-data")
    bt.add_argument("--budget-min", type=float, default=40)
    bt.add_argument("--rebuild", action="store_true")
    bt.add_argument("--chain", action="store_true")
    a = p.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s", stream=sys.stdout)
    store = DataStore(from_env())
    fetcher = Fetcher(delay=3.0)

    if a.cmd == "daily":
        jobs.run_daily(store, fetcher, lookback_days=a.lookback)
    elif a.cmd == "backfill-daily":
        before, left = jobs.run_backfill_daily(store, fetcher, years=a.years, budget_min=a.budget_min,
                                               max_days=a.max_days)
        if left and a.chain and left < before:     # 有進度才接力，避免卡在永遠失敗的日期
            jobs.redispatch("backfill.yml", {"job": "daily", "chain": "true", "years": f"{a.years:g}"})
    elif a.cmd == "backfill-finmind":
        before, left = jobs.run_backfill_finmind(store, fetcher, years=a.years, budget_min=a.budget_min,
                                                 max_codes=a.max_codes)
        if left and a.chain and left < before:
            jobs.redispatch("backfill.yml", {"job": "finmind", "chain": "true", "years": f"{a.years:g}"})
    elif a.cmd == "migrate-users":
        from . import migrate_users
        res = (migrate_users.check() if a.mode == "check" else migrate_users.selftest() if a.mode == "selftest"
               else migrate_users.migrate(store.st, a.mode))
        jobs.summary(f"## 使用者資料搬移（{a.mode}）\n\n{res}")
        print(res)
    elif a.cmd == "report":
        from .report import run_report
        run_report(store)
    elif a.cmd == "snapshot":
        from .snapshot import build_snapshot, write_snapshot
        df, meta = build_snapshot(store)
        write_snapshot(store, df, meta)
        jobs.summary(f"## 篩選快照\n\n資料日 {meta['asof']}，{meta['count']} 檔，{len(df.columns)} 欄")
    elif a.cmd == "stocks":
        from .stocks import build_all
        res = build_all(store, codes=a.codes.split(",") if a.codes else None)
        jobs.summary(f"## 個股檔\n\n{res['count']} 檔，平均 {res['avg_kb']} KB，合計 {res['total_mb']} MB，失敗 {res['n_failed']} 檔")
    elif a.cmd == "market":
        from .market import build_market, write_market
        from .market import build_indices, build_events, write_events, write_indices
        data = build_market(store)
        esize = write_events(store, build_events(store, data["asof"]))
        size = write_market(store, data)
        isize = write_indices(store, build_indices(store))
        log_ind = f"，指數歷史 {isize / 1024:.0f} KB，重大訊息 {esize / 1024:.0f} KB"
        jobs.summary(f"## 市場總覽\n\n資料日 {data['asof']}，指數 {len(data.get('indices', []))} 項，{size / 1024:.0f} KB{log_ind}")
    elif a.cmd == "backfill-extras":
        from .market import backfill_extras
        jobs.summary(f"## 補充資料回補\n\n{backfill_extras(store, fetcher, days=a.days)} 個交易日")
    elif a.cmd == "backfill-indices":
        from .market import backfill_indices
        total, left = backfill_indices(store, fetcher, years=a.years, budget_min=a.budget_min)
        jobs.summary(f"## 指數歷史回補\n\n待補 {total} 天，剩 {left} 天")
    elif a.cmd == "backtest-data":
        from .backtest import run_backtest_data
        res = run_backtest_data(store, budget_min=a.budget_min, rebuild=a.rebuild)
        jobs.summary(f"## 回測資料\n\n本次新增 {len(res['built'])} 個月、失敗 {res['failed']}，"
                     f"可回測 {res['ready']}/{res['total']} 個月，價格檔 {res['px_kb']} KB，{res['minutes']} 分鐘")
        if a.chain and res["built"] and res["ready"] < res["total"]:
            jobs.redispatch("backtest.yml", {"chain": "true"})
    elif a.cmd == "fin-refresh":
        jobs.run_fin_refresh(store, fetcher, budget_min=a.budget_min)


if __name__ == "__main__":
    main()
