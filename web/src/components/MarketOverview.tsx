"use client";

import Link from "next/link";
import { useUrlState } from "@/hooks/useUrlState";
import { useEffect, useMemo, useState } from "react";
import AiMarket from "@/components/AiMarket";
import NewsList from "@/components/NewsList";
import Sentiment, { type SentimentData } from "@/components/Sentiment";
import Sparkline from "@/components/Sparkline";
import { Seg } from "@/components/Screener";
import { useSnapshot } from "@/hooks/useSnapshot";
import { breadthNotes, computeBreadth } from "@/lib/breadth";
import { fmt } from "@/lib/screener";

type Card = { label: string; name?: string; date: string; close: number | null; chg: number | null; chg_pct: number | null; spark: (number | null)[] };
interface Market {
  asof: string;
  indices: Card[];
  breadth?: Record<"all" | "TWSE" | "TPEX", { up: number; flat: number; down: number }>;
  turnover?: { value: number; volume: number; value_ratio: number | null; series: (number | null)[] };
  insti?: { date: string; foreign: number; trust: number; dealer: number; total: number; markets: string[]; series: { date: string; total: number | null }[] };
  margin?: { date: string; margin_amount: number; margin_amount_prev: number; short_lots: number; short_lots_prev: number };
  daytrade?: { date: string; TWSE?: number; TPEX?: number };
  industry_flow?: { days: number; items: { industry: string; amount: number | null }[] };
  sentiment?: SentimentData;
}

const yi = (v: number | null | undefined, d = 2) => (v == null ? "—" : (v / 1e8).toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
const toneCls = (v: number | null | undefined) => (v == null || v === 0 ? "text-muted" : v > 0 ? "text-up" : "text-down");
const sign = (v: number | null | undefined) => (v != null && v > 0 ? "+" : "");

const md = (d: string) => d.slice(5).replace("-", "/");

/** 資料日期標籤：比整頁資料日舊就用黃色，並附上更新頻率說明。 */
function DateTag({ date, asof, freq }: { date?: string; asof: string; freq?: string }) {
  if (!date) return freq ? <span className="text-xs text-muted">{freq}</span> : null;
  const old = date < asof;
  return (
    <span className={`num text-xs ${old ? "rounded bg-warn-bg px-1.5 py-0.5 text-warn-ink" : "text-muted"}`}
      title={old ? `這項資料是 ${date.replaceAll("-", "/")} 的，比整頁資料日（${asof.replaceAll("-", "/")}）舊` : undefined}>
      {md(date)}{freq ? `・${freq}` : ""}{old ? "（較舊）" : ""}
    </span>
  );
}

function Panel({ title, date, asof, freq, children }: { title: string; date?: string; asof: string; freq?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-bold text-ink">{title}</h2>
        <DateTag date={date} asof={asof} freq={freq} />
      </div>
      {children}
    </section>
  );
}

function Bars({ values }: { values: (number | null)[] }) {
  const max = Math.max(1, ...values.map((v) => Math.abs(v ?? 0)));
  return (
    <div className="flex h-12 items-center gap-[2px]" aria-hidden>
      {values.map((v, i) => (
        <div key={i} className="flex h-full flex-1 flex-col justify-center">
          <div className={`${(v ?? 0) >= 0 ? "self-end bg-up" : "bg-down"} w-full rounded-[1px]`}
            style={{ height: `${(Math.abs(v ?? 0) / max) * 50}%`, marginTop: (v ?? 0) >= 0 ? "auto" : 0, marginBottom: (v ?? 0) >= 0 ? "50%" : "auto" }} />
        </div>
      ))}
    </div>
  );
}

export default function MarketOverview() {
  const [m, setM] = useState<Market | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useUrlState<"all" | "TWSE" | "TPEX">("m", "all", ["all", "TWSE", "TPEX"]);
  useEffect(() => {
    fetch("/api/market").then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setM(j);
    }).catch((e) => setError(String(e.message ?? e)));
  }, []);

  const { snap } = useSnapshot();
  const structure = useMemo(() => {
    if (!snap || !m) return null;
    const b = computeBreadth(snap.rows, scope);
    const idx = m.indices.find((c) => c.label.includes("加權") || c.name === "發行量加權股價指數");
    const otc = m.indices.find((c) => c.label.includes("櫃買"));
    const pct = scope === "TPEX" ? otc?.chg_pct : idx?.chg_pct;
    return { b, notes: breadthNotes(b, pct ?? null, m.turnover?.value_ratio), late: snap.meta.asof < m.asof, snapAsof: snap.meta.asof };
  }, [snap, m, scope]);

  if (error) return <div className="mx-auto max-w-[1440px] px-4 py-5"><p className="rounded-lg border border-up/40 bg-surface p-3 text-sm text-up">無法載入市場資料：{error}</p></div>;
  if (!m) return <div className="mx-auto max-w-[1440px] px-4 py-5 text-sm text-muted">載入市場資料中…</div>;
  const b = m.breadth?.[scope];
  const btotal = b ? b.up + b.flat + b.down : 0;
  const flow = m.industry_flow?.items ?? [];
  const inflow = [...flow].filter((x) => (x.amount ?? 0) > 0).reverse().slice(0, 8);
  const outflow = flow.filter((x) => (x.amount ?? 0) < 0).slice(0, 8);
  const fmax = Math.max(1, ...[...inflow, ...outflow].map((x) => Math.abs(x.amount ?? 0)));

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h1 className="text-xl font-bold text-ink">市場總覽</h1>
        <span className="num text-sm text-muted">資料日期：{m.asof.replaceAll("-", "/")}</span>
      </div>

      {/* 手機第一屏：三個最重要的數字＋漲跌家數；類股指數改成緊湊列表 */}
      {(() => {
        const key = m.indices.filter((c) => /加權/.test(c.label) || /櫃買/.test(c.label) || c.label === "台指期");
        const rest = m.indices.filter((c) => !key.includes(c));
        const all = m.breadth?.all;
        const tot = all ? all.up + all.flat + all.down : 0;
        return (
          <div className="mt-3 lg:hidden">
            <ul className="grid grid-cols-3 gap-2">
              {key.map((c) => (
                <li key={c.label}>
                  <Link href={`/market/index/${encodeURIComponent(c.name ?? c.label)}`} className="block rounded-lg border border-line bg-surface px-2 py-2">
                    <div className="truncate text-xs text-muted">{c.label.replace("發行量加權股價指數", "加權指數")}</div>
                    <div className={`num text-base font-bold leading-tight ${toneCls(c.chg)}`}>{fmt(c.close, "price").replace(/\.\d+$/, "")}</div>
                    <div className={`num text-xs ${toneCls(c.chg)}`}>{sign(c.chg_pct)}{fmt(c.chg_pct, "num")}%</div>
                  </Link>
                </li>
              ))}
            </ul>
            {all && tot > 0 && (
              <div className="mt-2 rounded-lg border border-line bg-surface px-3 py-2">
                <div className="num flex justify-between text-xs"><span className="text-up">上漲 {all.up}</span><span className="text-muted">平盤 {all.flat}</span><span className="text-down">下跌 {all.down}</span></div>
                <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full" aria-hidden>
                  <div className="bg-up" style={{ width: `${(all.up / tot) * 100}%` }} /><div className="bg-line" style={{ width: `${(all.flat / tot) * 100}%` }} /><div className="bg-down" style={{ width: `${(all.down / tot) * 100}%` }} />
                </div>
              </div>
            )}
            <details className="group mt-2 rounded-lg border border-line bg-surface">
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm text-ink">
                類股與其他指數（{rest.length}）<span className="text-xs text-muted group-open:hidden">展開</span><span className="hidden text-xs text-muted group-open:inline">收起</span>
              </summary>
              <ul className="divide-y divide-line border-t border-line">
                {rest.map((c) => (
                  <li key={c.label}>
                    <Link href={`/market/index/${encodeURIComponent(c.name ?? c.label)}`} className="num grid grid-cols-[1fr_auto_4.5rem] gap-2 px-3 py-1.5 text-sm">
                      <span className="truncate text-ink">{c.label}</span>
                      <span className="text-right text-ink">{fmt(c.close, "price")}</span>
                      <span className={`text-right ${toneCls(c.chg)}`}>{sign(c.chg_pct)}{fmt(c.chg_pct, "num")}%</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          </div>
        );
      })()}

      {/* 指數全覽（電腦版） */}
      <ul className="mt-4 hidden grid-cols-2 gap-2 sm:grid-cols-3 lg:grid lg:grid-cols-5">
        {m.indices.map((c) => (
          <li key={c.label}>
            <Link href={`/market/index/${encodeURIComponent(c.name ?? c.label)}`}
              className="block h-full rounded-lg border border-line bg-surface p-3 transition-colors hover:border-accent">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-sm text-ink">{c.label}</span>
              {c.date !== m.asof && (
                <span className="num shrink-0 rounded bg-warn-bg px-1 text-[11px] text-warn-ink"
                  title={c.date < m.asof ? "這個指數的資料比整頁舊（期交所的公開資料隔一個交易日才更新）" : undefined}>{md(c.date)}</span>
              )}
            </div>
            <div className={`num mt-1 text-lg font-bold ${toneCls(c.chg)}`}>{fmt(c.close, "price")}</div>
            <div className={`num text-xs ${toneCls(c.chg)}`}>{sign(c.chg)}{fmt(c.chg, "price")}（{sign(c.chg_pct)}{fmt(c.chg_pct, "num")}%）</div>
            <div className="mt-2"><Sparkline data={c.spark} up={c.chg == null ? null : c.chg >= 0} width={140} height={32} /></div>
            </Link>
          </li>
        ))}
      </ul>

      <AiMarket />

      <div className="mt-4 grid gap-3 lg:grid-cols-4">
        <div className="hidden lg:block">
        <Panel title="漲跌家數" date={m.asof} asof={m.asof} freq="每日盤後">
          <Seg label="市場" value={scope} onChange={setScope} options={[["all", "全部"], ["TWSE", "上市"], ["TPEX", "上櫃"]]} />
          {b && (
            <>
              <div className="num mt-3 grid grid-cols-3 text-center">
                <div><div className="text-lg font-bold text-up">{b.up}</div><div className="text-xs text-muted">上漲</div></div>
                <div><div className="text-lg font-bold text-muted">{b.flat}</div><div className="text-xs text-muted">平盤</div></div>
                <div><div className="text-lg font-bold text-down">{b.down}</div><div className="text-xs text-muted">下跌</div></div>
              </div>
              <div className="mt-3 flex h-2 overflow-hidden rounded-full" aria-hidden>
                <div className="bg-up" style={{ width: `${(b.up / btotal) * 100}%` }} />
                <div className="bg-line" style={{ width: `${(b.flat / btotal) * 100}%` }} />
                <div className="bg-down" style={{ width: `${(b.down / btotal) * 100}%` }} />
              </div>
            </>
          )}
        </Panel>
        </div>

        <Panel title="成交值（股票＋ETF）" date={m.asof} asof={m.asof} freq="每日盤後">
          {m.turnover && (
            <>
              <div className="num text-2xl font-bold text-ink">{yi(m.turnover.value, 0)}<span className="ml-1 text-sm font-normal text-muted">億</span></div>
              <div className="num mt-1 text-xs text-muted">量比（對 20 日均值）{fmt(m.turnover.value_ratio, "num")} 倍</div>
              {m.daytrade && <div className="num mt-1 text-xs text-muted">當沖占比：上市 {fmt(m.daytrade.TWSE, "num")}%{m.daytrade.TPEX != null && `、上櫃 ${fmt(m.daytrade.TPEX, "num")}%`}</div>}
            </>
          )}
        </Panel>

        <Panel title={`三大法人買賣超（${m.insti?.markets.length === 2 ? "上市＋上櫃" : "上市"}）`} date={m.insti?.date} asof={m.asof} freq="每日盤後">
          {m.insti && (
            <>
              <div className={`num text-2xl font-bold ${toneCls(m.insti.total)}`}>{sign(m.insti.total)}{yi(m.insti.total)}<span className="ml-1 text-sm font-normal text-muted">億</span></div>
              <dl className="num mt-2 grid grid-cols-3 gap-1 text-xs">
                {(["foreign", "trust", "dealer"] as const).map((k) => (
                  <div key={k}><dt className="text-muted">{{ foreign: "外資", trust: "投信", dealer: "自營商" }[k]}</dt>
                    <dd className={toneCls(m.insti![k])}>{sign(m.insti![k])}{yi(m.insti![k])}</dd></div>
                ))}
              </dl>
              <div className="mt-2"><Bars values={m.insti.series.map((x) => x.total)} /></div>
            </>
          )}
        </Panel>

        <Panel title="融資融券（上市）" date={m.margin?.date} asof={m.asof} freq="晚間公布">
          {m.margin && (
            <dl className="num space-y-2 text-sm">
              <div>
                <dt className="text-xs text-muted">融資餘額</dt>
                <dd className="text-lg font-bold text-ink">{yi(m.margin.margin_amount, 1)} 億
                  <span className={`ml-2 text-xs ${toneCls(m.margin.margin_amount - m.margin.margin_amount_prev)}`}>
                    {sign(m.margin.margin_amount - m.margin.margin_amount_prev)}{yi(m.margin.margin_amount - m.margin.margin_amount_prev)} 億</span></dd>
              </div>
              <div>
                <dt className="text-xs text-muted">融券餘額</dt>
                <dd className="text-lg font-bold text-ink">{fmt(m.margin.short_lots, "lots")} 張
                  <span className={`ml-2 text-xs ${toneCls(m.margin.short_lots - m.margin.short_lots_prev)}`}>
                    {sign(m.margin.short_lots - m.margin.short_lots_prev)}{fmt(m.margin.short_lots - m.margin.short_lots_prev, "lots")}</span></dd>
              </div>
            </dl>
          )}
        </Panel>
      </div>

      {structure && (
        <section className="mt-3 rounded-lg border border-line bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 className="text-sm font-bold text-ink">市場結構（{scope === "all" ? "上市＋上櫃" : scope === "TWSE" ? "上市" : "上櫃"}普通股 {structure.b.n} 檔）</h2>
            <DateTag date={structure.snapAsof} asof={m.asof} freq="每日盤後" />
          </div>
          <ul className="space-y-1.5">
            {structure.notes.map((n, i) => (
              <li key={i} className={`rounded-md px-3 py-2 text-sm leading-relaxed ${n.tone === "warn" ? "bg-warn-bg text-warn-ink" : "bg-surface-2 text-ink"}`}>
                {n.tone === "warn" ? "⚠ " : n.tone === "good" ? "✓ " : ""}{n.text}
              </li>
            ))}
          </ul>
          <dl className="num mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4 lg:grid-cols-8">
            {([
              ["上漲家數比例", `${structure.b.upRatio.toFixed(0)}%`, "上漲 ÷（上漲＋下跌）"],
              ["站上 20 日線", `${structure.b.above20.toFixed(0)}%`, "收盤高於 20 日均線的個股比例"],
              ["站上 60 日線", `${structure.b.above60.toFixed(0)}%`, "收盤高於 60 日均線的個股比例"],
              ["站上 240 日線", `${structure.b.above240.toFixed(0)}%`, "收盤高於年線的個股比例"],
              ["創 20 日新高", `${structure.b.newHigh20} 檔`, "收盤創近 20 日新高"],
              ["創 52 週新高／新低", `${structure.b.newHigh52}／${structure.b.newLow52}`, "收盤創近 52 週新高／新低的檔數"],
              ["成交值量比", m.turnover?.value_ratio != null ? `${fmt(m.turnover.value_ratio, "num")} 倍` : "—", "今日成交值 ÷ 20 日平均"],
              ["漲停／跌停（約）", `${structure.b.limitUp}／${structure.b.limitDown}`, "漲跌幅達 ±9.5% 以上，為近似值"],
            ] as const).map(([k, val, tip]) => (
              <div key={k} title={tip}><dt className="text-xs text-muted">{k}</dt><dd className="text-ink">{val}</dd></div>
            ))}
          </dl>
          <p className="mt-2 text-xs text-muted">用固定規則把數字翻成白話，只描述今天的狀態，不預測明天漲跌。</p>
        </section>
      )}

      <Sentiment s={m.sentiment} asof={m.asof} />

      <div className="mt-4 grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_420px]">
        <Panel title={`三大法人近 ${m.industry_flow?.days ?? 5} 日產業資金（估算）`} date={m.asof} asof={m.asof} freq="每日盤後・估算">
          <div className="grid gap-4 sm:grid-cols-2">
            {[["買超", inflow], ["賣超", outflow]].map(([title, rows]) => (
              <div key={title as string}>
                <h3 className="mb-2 text-xs text-muted">{title as string}</h3>
                <ul className="space-y-1.5">
                  {(rows as typeof inflow).map((x) => (
                    <li key={x.industry} className="grid grid-cols-[6.5rem_minmax(0,1fr)_4.5rem] items-center gap-2 text-sm">
                      <span className="truncate text-ink">{x.industry}</span>
                      <div className="h-2 rounded-full bg-surface-2">
                        <div className={`h-full rounded-full ${(x.amount ?? 0) > 0 ? "bg-up" : "bg-down"}`} style={{ width: `${(Math.abs(x.amount ?? 0) / fmax) * 100}%` }} />
                      </div>
                      <span className={`num text-right text-xs ${toneCls(x.amount)}`}>{sign(x.amount)}{yi(x.amount, 1)}億</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">以每天各股三大法人買賣超股數 × 收盤價估算，再依產業加總。</p>
        </Panel>
        <Panel title="台股新聞" asof={m.asof} freq="即時">
          <NewsList q="台股" limit={10} more />
        </Panel>
      </div>
    </div>
  );
}
