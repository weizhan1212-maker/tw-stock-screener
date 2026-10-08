"use client";

import { ColorType, createChart, LineSeries, type Time } from "lightweight-charts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { NumInput, Seg } from "@/components/Screener";
import { sortRows, type Sort } from "@/components/Results";
import { type BtData, type BtIndex, type BtResult, type BtSettings, DEFAULT_SETTINGS, loadData, loadIndex, pickMonths, simulate } from "@/lib/backtest";
import { FIELD_MAP } from "@/lib/fields";
import { type Condition, decodeConds, funnel, inUniverse, type Market, type Row, type Universe } from "@/lib/screener";
import { defaults, makeCtx, type Params, STRATEGIES, STRATEGY_MAP } from "@/lib/strategies";

const pct = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(d)}%`);
const tone = (v: number | null | undefined) => (v == null || Math.abs(v) < 0.005 ? "text-ink" : v > 0 ? "text-up" : "text-down");

type Source = { kind: "strategy"; id: string; params: Params } | { kind: "conds"; conds: Condition[]; universe: Universe; market: Market; sort: Sort };

function sourceName(s: Source) {
  if (s.kind === "strategy") return STRATEGY_MAP[s.id]?.name ?? s.id;
  return `自訂條件（${s.conds.map((c) => FIELD_MAP[c.field]?.label ?? c.field).join("、") || "無條件"}）`;
}

function selector(src: Source) {
  return (rows: Row[], meta: Record<string, unknown>): Row[] => {
    if (src.kind === "strategy") {
      const s = STRATEGY_MAP[src.id];
      return sortRows(s.run(makeCtx(rows, meta.market_bull as boolean | undefined), src.params), s.sort);
    }
    const pool = rows.filter((r) => inUniverse(r, src.universe, src.market));
    return sortRows(funnel(pool, src.conds).result, src.sort);
  };
}

/** 期間選項：資料夠長才出現 5 年、10 年 */
function yearOptions(nMonths: number): [string, string][] {
  const o: [string, string][] = [["1", "1 年"], ["2", "2 年"], ["3", "3 年"]];
  if (nMonths >= 60) o.push(["5", "5 年"]);
  if (nMonths >= 120) o.push(["10", "10 年"]);
  o.push(["0", "全部"]);
  return o;
}

export default function Backtest() {
  const q = useSearchParams();
  const initial = useMemo<Source>(() => {
    const c = q.get("c");
    if (c) {
      const [key, d] = (q.get("s") ?? "market_cap:desc").split(":");
      const u = q.get("u"), m = q.get("m");
      return { kind: "conds", conds: decodeConds(c), universe: u === "stock" || u === "etf" ? u : "all",
        market: m === "TWSE" || m === "TPEX" ? m : "all", sort: { key, dir: d === "asc" ? 1 : -1 } };
    }
    const id = q.get("st") && STRATEGY_MAP[q.get("st")!] ? q.get("st")! : "dividend";
    let params = defaults(STRATEGY_MAP[id]);
    try { params = { ...params, ...JSON.parse(q.get("p") ?? "{}") }; } catch { /* 忽略 */ }
    return { kind: "strategy", id, params };
  }, [q]);

  const [src, setSrc] = useState<Source>(initial);
  const [set, setSet] = useState<BtSettings>(DEFAULT_SETTINGS);
  const [index, setIndex] = useState<BtIndex | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState<string>("");
  const [res, setRes] = useState<{ r: BtResult; name: string; set: BtSettings } | null>(null);
  const [table, setTable] = useState<{ id: string; name: string; r: BtResult }[] | null>(null);

  useEffect(() => { document.title = "回測｜股見未來"; }, []);
  useEffect(() => { loadIndex().then(setIndex).catch((e) => setErr(String(e.message ?? e))); }, []);

  async function prepare(s: BtSettings): Promise<{ data: BtData; months: ReturnType<typeof pickMonths> }> {
    const months = pickMonths(index!.months, s);
    if (!months.length) throw new Error("這段期間沒有可回測的月份");
    const data = await loadData(index!, months, (d, t) => setBusy(`下載回測資料 ${d}/${t}…`));
    return { data, months };
  }

  async function run(source = src) {
    if (!index) return;
    setErr(""); setTable(null);
    try {
      const { data, months } = await prepare(set);
      setBusy("計算中…");
      await new Promise((r) => setTimeout(r, 20));
      setRes({ r: simulate(data, months, set, selector(source)), name: sourceName(source), set });
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    setBusy("");
  }

  async function runAll() {
    if (!index) return;
    setErr(""); setRes(null);
    try {
      const { data, months } = await prepare(set);
      const out: { id: string; name: string; r: BtResult }[] = [];
      for (const s of STRATEGIES) {
        setBusy(`計算 ${s.name}（${out.length + 1}/${STRATEGIES.length}）…`);
        await new Promise((r) => setTimeout(r, 0));
        out.push({ id: s.id, name: s.name, r: simulate(data, months, set, selector({ kind: "strategy", id: s.id, params: defaults(s) })) });
      }
      out.sort((a, b) => b.r.stats.cagr - a.r.stats.cagr);
      setTable(out);
    } catch (e) { setErr(String((e as Error).message ?? e)); }
    setBusy("");
  }

  const months = index ? pickMonths(index.months, set) : [];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <h1 className="text-xl font-bold text-ink">回測</h1>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        用過去的資料模擬「如果當時照這個方法選股」會怎樣。每期最後一個交易日收盤後選股，下一個交易日開盤買進，等權重持有到下次換股。
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        <aside className="space-y-3">
          <div className="rounded-lg border border-line bg-surface p-4">
            <label className="text-sm font-bold text-ink" htmlFor="bt-src">選股方法</label>
            {src.kind === "conds" ? (
              <div className="mt-2 text-sm text-ink">
                <p>{sourceName(src)}</p>
                <button type="button" className="mt-2 text-xs text-accent hover:underline"
                  onClick={() => setSrc({ kind: "strategy", id: "dividend", params: defaults(STRATEGY_MAP.dividend) })}>改用預設策略</button>
              </div>
            ) : (
              <>
                <select id="bt-src" value={src.id} onChange={(e) => setSrc({ kind: "strategy", id: e.target.value, params: defaults(STRATEGY_MAP[e.target.value]) })}
                  className="mt-2 w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink">
                  {(["基本策略", "大師策略", "單一條件"] as const).map((g) => (
                    <optgroup key={g} label={g}>
                      {STRATEGIES.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </optgroup>
                  ))}
                </select>
                <div className="mt-3 space-y-2">
                  {STRATEGY_MAP[src.id].params.map((x) => (
                    <label key={x.key} className="flex items-center justify-between gap-3 text-sm text-ink">
                      <span>{x.label}</span>
                      <span className="flex items-center gap-1.5">
                        <NumInput key={`${src.id}-${x.key}`} value={src.params[x.key]} label={x.label}
                          onChange={(n) => n != null && setSrc({ ...src, params: { ...src.params, [x.key]: n } })} />
                        <span className="w-6 text-muted">{x.unit ?? ""}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-line bg-surface p-4 text-sm text-ink">
            <div className="flex items-center justify-between gap-2">
              <span>期間</span>
              <Seg label="期間" value={String(set.years)} onChange={(v) => setSet({ ...set, years: Number(v) })}
                options={yearOptions(index?.months.length ?? 0)} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <span>換股頻率</span>
              <Seg label="換股頻率" value={set.freq} onChange={(v) => setSet({ ...set, freq: v })} options={[["month", "每月"], ["quarter", "每季"]]} />
            </div>
            <label className="flex items-center justify-between gap-2">
              <span>持股上限（等權重）</span>
              <span className="flex items-center gap-1.5">
                <NumInput value={set.maxHold} label="持股上限" onChange={(n) => n != null && setSet({ ...set, maxHold: Math.min(50, Math.max(1, Math.round(n))) })} />
                <span className="w-6 text-muted">檔</span>
              </span>
            </label>
            <label className="flex items-center justify-between gap-2">
              <span>手續費折數</span>
              <span className="flex items-center gap-1.5">
                <NumInput value={set.feeDiscount * 10} label="手續費折數" onChange={(n) => n != null && n > 0 && n <= 10 && setSet({ ...set, feeDiscount: n / 10 })} />
                <span className="w-6 text-muted">折</span>
              </span>
            </label>
            {index && months.length > 0 && (
              <p className="text-xs text-muted">{months[0].exec} 起，共 {months.length} 次換股，資料到 {index.last_day}</p>
            )}
          </div>

          <button type="button" onClick={() => run()} disabled={!index || !!busy}
            className="w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50">開始回測</button>
          <button type="button" onClick={runAll} disabled={!index || !!busy}
            className="w-full rounded-lg border border-line px-4 py-2 text-sm text-ink hover:border-accent disabled:opacity-50">
            全部 {STRATEGIES.length} 套策略績效比較（預設數字）
          </button>
          {busy && <p className="text-sm text-muted">{busy}</p>}
          {err && <p className="rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">{err}</p>}
          {index && index.pending > 0 && (
            <p className="text-xs text-muted">還有 {index.pending} 個月份的歷史資料在準備中，可回測期間會再變長。</p>
          )}
        </aside>

        <div className="min-w-0">
          {!res && !table && !busy && (
            <div className="rounded-lg border border-dashed border-line p-6 text-sm text-muted">
              選好方法和設定後按「開始回測」。第一次需要下載幾 MB 的歷史資料，之後同一個分頁會變快。
            </div>
          )}
          {table && <CompareTable rows={table} onPick={(id) => { const s: Source = { kind: "strategy", id, params: defaults(STRATEGY_MAP[id]) }; setSrc(s); run(s); }} />}
          {res && <ResultView r={res.r} name={res.name} set={res.set} />}
          <Notes />
        </div>
      </div>
    </div>
  );
}

function Card({ label, value, sub, cls = "text-ink" }: { label: string; value: string; sub?: string; cls?: string }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-xs text-muted">{label}</div>
      <div className={`num mt-0.5 text-lg font-bold ${cls}`}>{value}</div>
      {sub && <div className="num text-xs text-muted">{sub}</div>}
    </div>
  );
}

function ResultView({ r, name, set }: { r: BtResult; name: string; set: BtSettings }) {
  const s = r.stats, b = r.benchStats;
  const [showTrades, setShowTrades] = useState(false);
  return (
    <div>
      <h2 className="text-base font-bold text-ink">{name}</h2>
      <p className="num text-xs text-muted">{r.dates[0]} ～ {r.dates[r.dates.length - 1]}・{set.freq === "month" ? "每月" : "每季"}換股・最多 {set.maxHold} 檔</p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-5">
        <Card label="總報酬" value={pct(s.total)} cls={tone(s.total)} sub={`大盤（含息）${pct(b.total)}`} />
        <Card label="年化報酬" value={pct(s.cagr)} cls={tone(s.cagr)} sub={`大盤 ${pct(b.cagr)}`} />
        <Card label="最大回撤" value={pct(s.mdd)} cls="text-down" sub={`大盤 ${pct(b.mdd)}`} />
        <Card label="年化波動" value={`${s.vol.toFixed(1)}%`} sub={`大盤 ${b.vol.toFixed(1)}%`} />
        <Card label="夏普值" value={s.sharpe == null ? "—" : s.sharpe.toFixed(2)} sub={`大盤 ${b.sharpe == null ? "—" : b.sharpe.toFixed(2)}`} />
        <Card label="月勝率" value={s.winMonth == null ? "—" : `${Math.round(s.winMonth)}%`} sub={`大盤 ${b.winMonth == null ? "—" : Math.round(b.winMonth)}%`} />
        <Card label="平均持股" value={`${r.avgHold.toFixed(1)} 檔`} />
        <Card label="每期換手率" value={`${r.turnover.toFixed(0)}%`} />
        <Card label="累計交易成本" value={`${r.costPct.toFixed(1)}%`} sub="占資產比例合計" />
      </div>

      <Equity r={r} />

      <h3 className="mt-6 text-sm font-bold text-ink">逐年報酬</h3>
      <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 text-left font-medium">年度</th><th className="px-3 py-2 text-right font-medium">策略</th><th className="px-3 py-2 text-right font-medium">大盤（含息）</th><th className="px-3 py-2 text-right font-medium">差距</th></tr></thead>
          <tbody>
            {r.yearly.map((y) => (
              <tr key={y.year} className="border-t border-line">
                <td className="num px-3 py-2 text-ink">{y.year}{y.year === r.dates[0].slice(0, 4) || y.year === r.dates[r.dates.length - 1].slice(0, 4) ? "（部分）" : ""}</td>
                <td className={`num px-3 py-2 text-right ${tone(y.ret)}`}>{pct(y.ret)}</td>
                <td className={`num px-3 py-2 text-right ${tone(y.bench)}`}>{pct(y.bench)}</td>
                <td className={`num px-3 py-2 text-right ${tone(y.bench == null ? null : y.ret - y.bench)}`}>{y.bench == null ? "—" : pct(y.ret - y.bench)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="mt-6 text-sm font-bold text-ink">每期持股</h3>
      <ol className="mt-2 space-y-1.5">
        {[...r.periods].reverse().map((p) => (
          <li key={p.month}>
            <details className="rounded-lg border border-line bg-surface">
              <summary className="num flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm text-ink">
                <span>{p.exec} 買進</span>
                <span className="text-muted">符合 {p.matched} 檔，持有 {p.picks.length} 檔</span>
                <span className={`ml-auto ${tone(p.ret)}`}>本期 {pct(p.ret)}</span>
              </summary>
              <div className="border-t border-line px-3 py-2 text-sm leading-relaxed text-ink">
                {p.picks.length === 0 ? "這期沒有符合的股票，持有現金。" : p.picks.map((h) => (
                  <Link key={h.code} href={`/stock/${h.code}`} className="mr-3 inline-block hover:text-accent hover:underline">{h.code} {h.name}</Link>
                ))}
              </div>
            </details>
          </li>
        ))}
      </ol>

      <h3 className="mt-6 text-sm font-bold text-ink">交易紀錄</h3>
      <button type="button" onClick={() => setShowTrades((v) => !v)} className="mt-1 text-sm text-accent hover:underline">
        {showTrades ? "收起" : `展開（共 ${r.trades.length} 筆）`}
      </button>
      {showTrades && (
        <div className="mt-2 max-h-[480px] overflow-auto rounded-lg border border-line bg-surface">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-surface-2 text-xs text-muted"><tr><th className="px-3 py-2 text-left font-medium">日期</th><th className="px-3 py-2 text-left font-medium">股票</th><th className="px-3 py-2 text-left font-medium">動作</th><th className="px-3 py-2 text-right font-medium">占資產</th></tr></thead>
            <tbody>
              {r.trades.map((t, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="num px-3 py-1.5 text-muted">{t.date}</td>
                  <td className="px-3 py-1.5 text-ink">{t.code} {t.name}</td>
                  <td className={`px-3 py-1.5 ${t.side === "買進" || t.side === "加碼" ? "text-up" : "text-down"}`}>{t.side}</td>
                  <td className="num px-3 py-1.5 text-right text-ink">{t.pct.toFixed(1)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Equity({ r }: { r: BtResult }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const v = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: v("--surface") }, textColor: v("--muted"), fontSize: 11, fontFamily: "'Noto Sans TC', system-ui, sans-serif" },
      grid: { vertLines: { visible: false }, horzLines: { color: v("--line") } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
      handleScroll: false, handleScale: false,
      localization: { locale: "zh-TW", dateFormat: "yyyy/MM/dd" },
    });
    const a = chart.addSeries(LineSeries, { color: v("--accent"), lineWidth: 2, priceLineVisible: false, title: "策略" });
    const b = chart.addSeries(LineSeries, { color: v("--muted"), lineWidth: 1, priceLineVisible: false, title: "大盤（含息）" });
    a.setData(r.dates.map((d, i) => ({ time: d as Time, value: r.equity[i] * 100 })));
    b.setData(r.dates.map((d, i) => ({ time: d as Time, value: r.bench[i] * 100 })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [r]);
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-2">
      <p className="px-1 text-xs text-muted">資產變化（起點 = 100）：<span className="text-accent">━ 策略</span>　<span>━ 大盤（含息）</span></p>
      <div ref={box} className="h-[280px] w-full sm:h-[340px]" />
    </div>
  );
}

function CompareTable({ rows, onPick }: { rows: { id: string; name: string; r: BtResult }[]; onPick: (id: string) => void }) {
  const b = rows[0]?.r.benchStats;
  return (
    <div>
      <h2 className="text-base font-bold text-ink">策略績效比較</h2>
      <p className="mt-1 text-xs text-muted">全部用預設數字、同一組回測設定。點策略名稱看完整回測。大盤（含息）年化 {pct(b?.cagr)}、最大回撤 {pct(b?.mdd)}。</p>
      <div className="mt-2 overflow-x-auto rounded-lg border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-2 text-xs text-muted">
            <tr>{["策略", "年化報酬", "總報酬", "最大回撤", "夏普值", "月勝率", "平均持股"].map((h, i) => (
              <th key={h} className={`px-3 py-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>))}</tr>
          </thead>
          <tbody>
            {rows.map(({ id, name, r }) => (
              <tr key={id} className="border-t border-line hover:bg-surface-2">
                <td className="px-3 py-2"><button type="button" onClick={() => onPick(id)} className="text-left text-ink hover:text-accent hover:underline">{name}</button></td>
                <td className={`num px-3 py-2 text-right ${tone(r.stats.cagr - (b?.cagr ?? 0))}`}>{pct(r.stats.cagr)}</td>
                <td className="num px-3 py-2 text-right text-ink">{pct(r.stats.total)}</td>
                <td className="num px-3 py-2 text-right text-down">{pct(r.stats.mdd)}</td>
                <td className="num px-3 py-2 text-right text-ink">{r.stats.sharpe == null ? "—" : r.stats.sharpe.toFixed(2)}</td>
                <td className="num px-3 py-2 text-right text-ink">{r.stats.winMonth == null ? "—" : `${Math.round(r.stats.winMonth)}%`}</td>
                <td className="num px-3 py-2 text-right text-ink">{r.avgHold.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-muted">年化報酬紅色＝贏大盤、綠色＝輸大盤。</p>
    </div>
  );
}

function Notes() {
  return (
    <details className="mt-6 rounded-lg border border-line bg-surface p-4 text-sm leading-relaxed text-ink">
      <summary className="cursor-pointer font-bold">回測規則與限制</summary>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>每期最後一個交易日收盤後選股，下一個交易日開盤價成交（不偷看未來）；等權重，持股上限內依策略排序取前幾名。</li>
        <li>交易成本：手續費 0.1425%（可打折）、賣出證交稅 0.3%、買賣各計滑價 0.1%。</li>
        <li>使用還原股價，股利視為再投入；比較基準是加權股價報酬指數（含息）。</li>
        <li>季財報在法定公布期限後才納入（Q1 5/15、Q2 8/14、Q3 11/14、年報隔年 3/31），月營收次月 10 日後才納入。</li>
        <li>包含已下市股票；持有中下市或停牌，沿用最後收盤價，下次換股時以該價格出場。該期沒有符合的股票就持有現金。</li>
        <li>限制：發行股數、產業別、財報重編使用最新資料，會有輕微偏差；集保大戶資料從 2026 年 10 月才開始累積；回測只含普通股（不含 ETF）。</li>
        <li>過去績效不代表未來報酬，回測結果僅供研究參考，不構成投資建議。</li>
      </ul>
    </details>
  );
}
