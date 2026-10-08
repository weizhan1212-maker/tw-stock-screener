"use client";

/** 自選股頁：每人自己的清單，顯示當日漲跌、量、評級與符合的策略。 */
import Link from "next/link";
import { useMemo, useState } from "react";
import DataStatus from "@/components/DataStatus";
import Results, { type Sort } from "@/components/Results";
import { useLiveQuotes } from "@/hooks/useLiveQuotes";
import { useSnapshot } from "@/hooks/useSnapshot";
import { useWatchlist } from "@/hooks/useWatchlist";
import type { Row } from "@/lib/screener";
import { defaults, makeCtx, STRATEGIES } from "@/lib/strategies";

const COLS = ["close", "chg_pct", "volume_lots", "value", "pe", "dividend_yield", "health_score", "foreign_net", "trust_net"];

export default function Watchlist() {
  const { snap, error } = useSnapshot();
  const w = useWatchlist();
  const [sort, setSort] = useState<Sort>({ key: "_order", dir: 1 });

  // 盤中即時（富果免費方案每分鐘 60 次，所以只更新前 30 檔、每分鐘一次；已核准成員都拿得到）
  const liveCodes = useMemo(() => (w.codes ?? []).slice(0, 30), [w.codes]);
  const live = useLiveQuotes(liveCodes, 60_000);

  const rows = useMemo(() => {
    if (!snap || !w.codes) return [];
    const by = new Map(snap.rows.map((r) => [r.code as string, r]));
    return w.codes.flatMap((c, i): Row[] => {
      if (!by.has(c)) return [];
      const r: Row = { ...by.get(c)!, _order: i };
      const q = live?.[c];
      if (q && q.price != null && q.date >= snap.meta.asof) {
        Object.assign(r, { close: q.price, chg_pct: q.pct, volume_lots: q.volLots, value: q.value, _live: 1 });
      }
      return [r];
    });
  }, [snap, w.codes, live]);

  const liveTime = useMemo(() => {
    const ts = Object.values(live ?? {}).map((q) => q.time).filter(Boolean) as string[];
    if (!ts.length) return null;
    const t = new Date(ts.sort().at(-1)!);
    return t.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
  }, [live]);

  const matched = useMemo(() => {
    const m = new Map<string, string[]>();
    if (!snap || !rows.length) return m;
    const ctx = makeCtx(snap.rows, snap.meta.market_bull);
    const mine = new Set(rows.map((r) => r.code as string));
    for (const s of STRATEGIES) {
      for (const r of s.run(ctx, defaults(s))) {
        const c = r.code as string;
        if (mine.has(c)) m.set(c, [...(m.get(c) ?? []), s.name]);
      }
    }
    return m;
  }, [snap, rows]);

  const manual = sort.key === "_order";

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold text-ink">自選股</h1>
        <DataStatus snap={snap} error={error} />
        {(w.codes?.length ?? 0) >= 2 && (
          <Link href={`/compare?codes=${w.codes!.slice(0, 6).join(",")}`} className="text-sm text-accent hover:underline">比較前 6 檔 →</Link>
        )}
        {liveTime && (
          <span className="rounded bg-accent-soft px-1.5 py-0.5 text-xs text-accent">
            收盤價、漲跌、量、金額為即時資料（{liveTime}，前 30 檔，每分鐘更新）
          </span>
        )}
        {Object.values(live ?? {}).some((q) => q.stale) && (
          <span className="rounded bg-warn-bg px-1.5 py-0.5 text-xs text-warn-ink">查詢額度暫時用完，部分報價是稍早的資料</span>
        )}
        {!manual && (
          <button type="button" onClick={() => setSort({ key: "_order", dir: 1 })} className="text-sm text-accent underline-offset-2 hover:underline">
            改回我的排序
          </button>
        )}
      </div>
      {w.error && <p className="mb-3 rounded-md bg-warn-bg px-3 py-2 text-sm text-warn-ink">{w.error}</p>}

      {w.codes && w.codes.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-8 text-center">
          <p className="text-ink">還沒有自選股。</p>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            在任何股票列表或個股頁按 <span className="text-warn-ink">☆</span> 就會加進來；也可以用右上角搜尋找股票。
          </p>
          <Link href="/" className="mt-4 inline-block rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white">去看策略選股</Link>
        </div>
      ) : (
        <Results
          rows={rows} cols={COLS} sort={sort} setSort={setSort} loading={!snap || !w.codes}
          csvName={`自選股_${snap?.meta.asof ?? ""}`} countLabel="自選股"
          badge={(r) => {
            const m = matched.get(r.code as string);
            return m?.length ? (
              <span className="flex flex-wrap gap-1">
                {m.map((n) => <span key={n} className="rounded bg-accent-soft px-1.5 text-[11px] text-accent">{n}</span>)}
              </span>
            ) : null;
          }}
          actions={manual ? (r) => (
            <span className="inline-flex gap-0.5">
              <button type="button" onClick={() => w.move(r.code as string, -1)} aria-label={`${r.name} 往上移`} className="rounded px-1.5 text-muted hover:text-ink">↑</button>
              <button type="button" onClick={() => w.move(r.code as string, 1)} aria-label={`${r.name} 往下移`} className="rounded px-1.5 text-muted hover:text-ink">↓</button>
            </span>
          ) : undefined}
        />
      )}
      <p className="mt-3 text-xs text-muted">自選股存在你的帳號，換手機或電腦登入同一個 Google 帳號都看得到。點欄位名稱可以暫時排序。</p>
    </div>
  );
}
