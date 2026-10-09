"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import DataStatus from "@/components/DataStatus";
import Results, { type Sort } from "@/components/Results";
import { NumInput } from "@/components/Screener";
import { useSnapshot } from "@/hooks/useSnapshot";
import { encodeConds } from "@/lib/screener";
import { defaults, isLiquid, makeCtx, MIN_AVG_VALUE, type Params, pending, STRATEGY_MAP } from "@/lib/strategies";

export default function StrategyDetail({ id }: { id: string }) {
  const s = STRATEGY_MAP[id];
  const { snap, error } = useSnapshot();
  const [p, setP] = useState<Params>(() => defaults(s));
  const [sort, setSort] = useState<Sort>(s.sort);
  const ctx = useMemo(() => (snap ? makeCtx(snap.rows, snap.meta.market_bull) : null), [snap]);
  const allRows = useMemo(() => (ctx ? s.run(ctx, p) : []), [ctx, s, p]);
  // 預設排除成交清淡的股票（營收極小或冷門股的比率常常失真），可以關掉
  const [liquidOnly, setLiquidOnly] = useState(true);
  const rows = useMemo(() => (liquidOnly ? allRows.filter(isLiquid) : allRows), [allRows, liquidOnly]);
  const accumulating = ctx ? pending(s, ctx.stocks) : false;
  const notice = ctx && s.notice ? s.notice(ctx) : null;
  const cols = useMemo(() => {
    const c = [...s.cols];
    if (!c.includes("value")) c.splice(c.indexOf("chg_pct") + 1, 0, "value");
    return c;
  }, [s]);
  const changed = s.params.some((x) => p[x.key] !== x.value);
  const template = s.toConditions
    ? `/screener?u=stock&c=${encodeURIComponent(encodeConds(s.toConditions(p).map((c, i) => ({ ...c, id: String(i) }))))}`
    : null;

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <nav className="mb-2 text-sm"><Link href="/strategy" className="text-muted hover:text-ink">← 策略選股</Link></nav>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-bold text-ink">{s.name}</h1>
        {s.author && <span className="text-sm text-muted">{s.author}</span>}
        {s.category && <span className="text-sm text-muted">單一條件・{s.category}</span>}
        <DataStatus snap={snap} error={error} />
      </div>
      <p className="mt-3 max-w-3xl text-[15px] leading-relaxed text-ink">{s.plain}</p>

      <div className="mt-5 grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="rounded-lg border border-line bg-surface p-4">
            <h2 className="text-sm font-bold text-ink">條件</h2>
            <ul className="mt-2 space-y-1.5 text-sm leading-relaxed text-ink">
              {s.rules(p).map((r) => (
                <li key={r} className="flex gap-2"><span aria-hidden className="text-muted">·</span><span>{r}</span></li>
              ))}
            </ul>
          </div>

          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-ink">調整數字</h2>
              {changed && (
                <button type="button" onClick={() => setP(defaults(s))} className="text-xs text-muted hover:text-ink">恢復預設</button>
              )}
            </div>
            <div className="mt-3 space-y-2.5">
              {s.params.map((x) => (
                <label key={x.key} className="flex items-center justify-between gap-3 text-sm text-ink">
                  <span>{x.label}</span>
                  <span className="flex items-center gap-1.5">
                    <NumInput value={p[x.key]} label={x.label} onChange={(n) => n != null && setP((o) => ({ ...o, [x.key]: n }))} />
                    <span className="w-6 text-muted">{x.unit ?? ""}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {(s.period || s.finance || s.notFor) && (
            <div className="rounded-lg border border-line bg-surface p-4 text-sm leading-relaxed text-ink">
              {s.period && (<><h2 className="font-bold">資料期間</h2><p className="mt-1">{s.period}</p></>)}
              {s.finance && (<><h2 className="mt-3 font-bold">金融股處理</h2><p className="mt-1">{s.finance}</p></>)}
              {s.notFor && s.notFor.length > 0 && (
                <>
                  <h2 className="mt-3 font-bold text-warn-ink">不適用情境</h2>
                  <ul className="mt-1 space-y-1">
                    {s.notFor.map((x) => (
                      <li key={x} className="flex gap-2"><span aria-hidden className="text-muted">·</span><span>{x}</span></li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          <Link href={`/backtest?st=${s.id}&p=${encodeURIComponent(JSON.stringify(p))}`}
            className="block rounded-lg bg-accent px-3 py-2.5 text-center text-sm font-bold text-white hover:opacity-90">
            一鍵回測這套策略（用目前的數字）
          </Link>
          <Link href={`/alerts?strategy=${s.id}`} className="block rounded-lg border border-line px-3 py-2 text-center text-sm text-ink hover:border-accent">
            有新股票入選時通知我
          </Link>

          {template && (
            <Link href={template} className="block rounded-lg border border-dashed border-line p-3 text-sm text-ink hover:border-accent">
              以這套策略為範本，到自訂篩選繼續加條件
            </Link>
          )}
          {s.group === "大師策略" && (
            <p className="text-xs leading-relaxed text-muted">
              這是依公開著作整理的台股量化近似版，原始方法還包含很多質化判斷，結果僅供研究參考，非原作者背書，也不構成投資建議。
            </p>
          )}
        </aside>

        <div>
          {notice && <p className="mb-3 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">{notice}</p>}
          {accumulating && s.needs && <p className="mb-3 rounded-lg bg-surface-2 px-3 py-2 text-sm text-ink">{s.needs.msg}</p>}
          <label className="mb-2 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={liquidOnly} onChange={(e) => setLiquidOnly(e.target.checked)} />
            排除成交清淡的股票（20 日均成交值 &lt; {MIN_AVG_VALUE} 億）
            {liquidOnly && allRows.length > rows.length && <span className="text-xs text-muted">已排除 {allRows.length - rows.length} 檔</span>}
          </label>
          <Results
            key={JSON.stringify(p)}
            rows={rows} cols={cols} sort={sort} setSort={setSort} loading={!snap}
            csvName={`${s.name}_${snap?.meta.asof ?? ""}`}
            empty={<p className="mb-3 rounded-lg border border-line bg-surface p-4 text-sm text-ink">目前沒有符合的股票，可以在左邊放寬數字試試。</p>}
          />
        </div>
      </div>
    </div>
  );
}
