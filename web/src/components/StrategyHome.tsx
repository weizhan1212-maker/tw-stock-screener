"use client";

import Link from "next/link";
import { useMemo } from "react";
import DataStatus from "@/components/DataStatus";
import { sortRows } from "@/components/Results";
import { useSnapshot } from "@/hooks/useSnapshot";
import { useWatchlist } from "@/hooks/useWatchlist";
import { fmt, type Row } from "@/lib/screener";
import { defaults, makeCtx, STRATEGIES, type Strategy } from "@/lib/strategies";

export default function StrategyHome() {
  const { snap, error } = useSnapshot();
  const results = useMemo(() => {
    if (!snap) return null;
    const ctx = makeCtx(snap.rows, snap.meta.market_bull);
    return Object.fromEntries(STRATEGIES.map((s) => [s.id, sortRows(s.run(ctx, defaults(s)), s.sort)]));
  }, [snap]);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold text-ink">策略選股</h1>
        <DataStatus snap={snap} error={error} />
      </div>
      {snap?.meta.taiex != null && (
        <p className="num mt-2 text-sm text-muted">
          加權指數 {fmt(snap.meta.taiex, "price")}
          {snap.meta.taiex_ma200 != null && (
            <>，200 日均線 {fmt(snap.meta.taiex_ma200, "price")}，
              <span className={snap.meta.market_bull ? "text-up" : "text-down"}>{snap.meta.market_bull ? "大盤在均線之上（偏多）" : "大盤在均線之下（偏空）"}</span>
            </>
          )}
        </p>
      )}

      {snap && <MyWatch rows={snap.rows} />}

      {(["基本策略", "大師策略"] as const).map((g) => (
        <section key={g} className="mt-6">
          <h2 className="mb-1 text-base font-bold text-ink">{g}</h2>
          <p className="mb-3 text-sm text-muted">
            {g === "基本策略" ? "最常見的五種選股思路，條件簡單、好理解。" : "依大師公開著作整理的台股量化版本（非原作者背書），條件數字都可以調整；每套都公開完整條件與不適用情境。"}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {STRATEGIES.filter((s) => s.group === g).map((s) => (
              <StrategyCard key={s.id} s={s} rows={results?.[s.id] ?? null} />
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-6">
        <h2 className="mb-1 text-base font-bold text-ink">單一條件</h2>
        <p className="mb-3 text-sm text-muted">只看一個重點訊號，適合當作篩選的起點，再到自訂篩選加其他條件。</p>
        {(["技術面", "籌碼面", "基本面"] as const).map((cat) => (
          <div key={cat} className="mb-4">
            <h3 className="mb-2 text-sm font-medium text-muted">{cat}</h3>
            <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {STRATEGIES.filter((s) => s.group === "單一條件" && s.category === cat).map((s) => (
                <SmallCard key={s.id} s={s} rows={results?.[s.id] ?? null} />
              ))}
            </ul>
          </div>
        ))}
      </section>

      <p className="mt-8 text-sm text-muted">
        想自己組條件？到 <Link href="/screener" className="text-accent underline underline-offset-2">自訂篩選</Link>。
      </p>
    </div>
  );
}

function StrategyCard({ s, rows }: { s: Strategy; rows: ReturnType<Strategy["run"]> | null }) {
  return (
    <li>
      <Link
        href={`/strategy/${s.id}`}
        className="flex h-full flex-col rounded-lg border border-line bg-surface p-4 transition-colors hover:border-accent"
      >
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-[15px] font-bold text-ink">{s.name}</span>
          <span className="num shrink-0 text-sm text-muted">
            {rows == null ? "…" : <><b className="text-lg text-ink">{rows.length}</b> 檔</>}
          </span>
        </div>
        {s.author && <span className="mt-0.5 text-xs text-muted">{s.author}</span>}
        <p className="mt-2 text-sm text-ink">{s.tagline}</p>
        <p className="mt-auto truncate pt-3 text-xs text-muted">
          {rows == null ? "計算中…" : rows.length === 0 ? "目前沒有符合的股票" : rows.slice(0, 4).map((r) => `${r.code} ${r.name}`).join("、")}
        </p>
      </Link>
    </li>
  );
}

function SmallCard({ s, rows }: { s: Strategy; rows: ReturnType<Strategy["run"]> | null }) {
  return (
    <li>
      <Link href={`/strategy/${s.id}`} className="flex h-full items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2.5 transition-colors hover:border-accent">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-ink">{s.name}</span>
          <span className="block truncate text-xs text-muted">{s.tagline}</span>
        </span>
        <span className="num shrink-0 text-sm text-muted">{rows == null ? "…" : <><b className="text-ink">{rows.length}</b> 檔</>}</span>
      </Link>
    </li>
  );
}

function MyWatch({ rows }: { rows: Row[] }) {
  const w = useWatchlist();
  if (!w.codes) return null;
  const by = new Map(rows.map((r) => [r.code as string, r]));
  const list = w.codes.flatMap((c) => (by.has(c) ? [by.get(c)!] : [])).slice(0, 8);
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-base font-bold text-ink">我的自選股</h2>
        <Link href="/watchlist" className="text-sm text-accent hover:underline">全部 {w.codes.length} 檔 →</Link>
      </div>
      {list.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-surface p-4 text-sm text-muted">在股票列表或個股頁按 ☆ 加入自選股，這裡就會顯示。</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {list.map((r) => {
            const c = r.chg_pct as number | null;
            return (
              <li key={r.code as string}>
                <Link href={`/stock/${r.code}`} className="block rounded-lg border border-line bg-surface px-3 py-2 hover:border-accent">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm text-ink">{r.name}</span>
                    <span className="num text-xs text-muted">{r.code}</span>
                  </div>
                  <div className="num mt-0.5 flex items-baseline justify-between">
                    <span className="text-ink">{fmt(r.close, "price")}</span>
                    <span className={`text-sm ${c == null || c === 0 ? "text-muted" : c > 0 ? "text-up" : "text-down"}`}>{fmt(c, "pct", true)}%</span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
