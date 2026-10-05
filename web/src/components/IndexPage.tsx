"use client";

/** 指數詳細頁：走勢圖（加權指數為 K 線，其他為收盤線）、期間漲跌、成分／產業股票列表。 */
import { AreaSeries, CandlestickSeries, ColorType, createChart, type Time } from "lightweight-charts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import DataStatus from "@/components/DataStatus";
import Results, { type Sort } from "@/components/Results";
import { useSnapshot } from "@/hooks/useSnapshot";
import type { Row } from "@/lib/screener";

interface Series { market: string; d: string[]; c: (number | null)[]; o?: (number | null)[]; h?: (number | null)[]; l?: (number | null)[] }
interface IndicesFile { asof: string; series: Record<string, Series> }

const LABEL: Record<string, string> = { "發行量加權股價指數": "加權指數" };
const label = (n: string) => LABEL[n] ?? n.replace(/類指數$/, "類");
// 指數名稱 → 產業分類關鍵字（FinMind 產業別）
const IND_MAP: Record<string, string[]> = {
  "化學生技醫療": ["化學", "生技醫療"], "電子": ["電子工業"], "電子工業": ["電子工業"],
  "建材營造": ["建材營造"], "航運": ["航運"], "觀光餐旅": ["觀光"], "貿易百貨": ["貿易百貨"],
  "油電燃氣": ["油電燃氣"], "其他電子": ["其他電子"], "電子通路": ["電子通路"], "資訊服務": ["資訊服務"],
};

function pool(name: string, rows: Row[]): { rows: Row[]; note: string } | null {
  const stocks = rows.filter((r) => r.sec_type === "stock");
  if (name === "發行量加權股價指數") return { rows: stocks.filter((r) => r.market === "TWSE"), note: "全部上市普通股" };
  if (name === "櫃買指數") return { rows: stocks.filter((r) => r.market === "TPEX"), note: "全部上櫃普通股" };
  const m = name.match(/^(.+?)類?指數$/);
  if (!m || name.includes("報酬")) return null;
  const key = m[1].replace(/類$/, "");
  const kws = IND_MAP[key] ?? [key];
  const hit = stocks.filter((r) => kws.some((k) => String(r.industry ?? "").includes(k)));
  return hit.length ? { rows: hit, note: `產業分類含「${kws.join("、")}」的上市櫃普通股` } : null;
}

const RANGES: [string, number][] = [["1 月", 22], ["3 月", 66], ["6 月", 130], ["1 年", 250], ["3 年", 750], ["全部", 99999]];

export default function IndexPage({ name: asked }: { name: string }) {
  const router = useRouter();
  const [data, setData] = useState<IndicesFile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { snap, error: snapErr } = useSnapshot();
  const [range, setRange] = useState(130);
  const [sort, setSort] = useState<Sort>({ key: "market_cap", dir: -1 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/indices")
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`); setData(j); })
      .catch((e) => setError(String(e.message ?? e)));
  }, []);

  // 網址可能是完整名稱（半導體類指數）或顯示名稱（半導體類、加權指數），兩種都對得到
  const name = useMemo(() => {
    if (!data || data.series[asked]) return asked;
    return Object.keys(data.series).find((k) => label(k) === asked) ?? asked;
  }, [data, asked]);
  const s = data?.series[name];
  useEffect(() => { document.title = `${label(name)}｜股見未來`; }, [name]);
  const names = useMemo(() => {
    if (!data) return [];
    const key = ["發行量加權股價指數", "櫃買指數", "台指期", "台指期盤後"];
    const rest = Object.keys(data.series).filter((n) => !key.includes(n) && !n.includes("報酬")).sort((a, b) => a.localeCompare(b, "zh-Hant"));
    return [...key.filter((n) => data.series[n]), ...rest];
  }, [data]);

  const stats = useMemo(() => {
    if (!s) return null;
    const c = s.c.filter((x): x is number => x != null);
    const last = c[c.length - 1], prev = c[c.length - 2];
    const ret = (n: number) => (c.length > n ? (last / c[c.length - 1 - n] - 1) * 100 : null);
    const y = c.slice(-250);
    return { last, chg: prev != null ? last - prev : null, pct: prev ? (last / prev - 1) * 100 : null,
      r1m: ret(22), r3m: ret(66), r1y: ret(250), hi: Math.max(...y), lo: Math.min(...y), date: s.d[s.d.length - 1] };
  }, [s]);

  useEffect(() => {
    const el = box.current;
    if (!el || !s) return;
    const v = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: v("--surface") }, textColor: v("--muted"), fontSize: 11, fontFamily: "'Noto Sans TC', system-ui, sans-serif" },
      grid: { vertLines: { visible: false }, horzLines: { color: v("--line") } },
      rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false, rightOffset: 3 },
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      localization: { locale: "zh-TW", dateFormat: "yyyy/MM/dd" },
    });
    const n = s.d.length;
    if (s.o && s.h && s.l) {
      const up = v("--up"), down = v("--down");
      const ser = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceLineVisible: false });
      ser.setData(s.d.flatMap((d, i) => (s.c[i] == null || s.o![i] == null ? [] : [{ time: d as Time, open: s.o![i]!, high: s.h![i]!, low: s.l![i]!, close: s.c[i]! }])));
    } else {
      const acc = v("--accent");
      const ser = chart.addSeries(AreaSeries, { lineColor: acc, topColor: `${acc}33`, bottomColor: `${acc}00`, lineWidth: 2, priceLineVisible: false });
      ser.setData(s.d.flatMap((d, i) => (s.c[i] == null ? [] : [{ time: d as Time, value: s.c[i]! }])));
    }
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - range), to: n + 2 });
    return () => chart.remove();
  }, [s, range]);

  const p = useMemo(() => (snap && data ? pool(name, snap.rows) : null), [snap, data, name]);
  const breadth = useMemo(() => {
    if (!p) return null;
    let up = 0, down = 0, flat = 0, value = 0;
    for (const r of p.rows) {
      const c = r.chg_pct as number | null;
      if (c == null) continue;
      if (c > 0) up++; else if (c < 0) down++; else flat++;
      value += (r.value as number | null) ?? 0;
    }
    return { up, down, flat, value };
  }, [p]);

  const tone = (x: number | null | undefined) => (x == null || x === 0 ? "text-muted" : x > 0 ? "text-up" : "text-down");
  const n2 = (x: number | null | undefined, d = 2) => (x == null ? "—" : x.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const sg = (x: number | null | undefined) => (x != null && x > 0 ? "+" : "");

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-5">
      <nav className="mb-2 text-sm"><Link href="/market" className="text-muted hover:text-ink">← 市場總覽</Link></nav>
      <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
        <h1 className="text-2xl font-bold text-ink">{label(name)}</h1>
        {stats && (
          <div className="num flex items-baseline gap-2">
            <span className="text-3xl font-bold text-ink">{n2(stats.last)}</span>
            <span className={`text-lg ${tone(stats.chg)}`}>{sg(stats.chg)}{n2(stats.chg)}（{sg(stats.pct)}{n2(stats.pct)}%）</span>
            <span className="text-sm text-muted">{stats.date.replaceAll("-", "/")}</span>
          </div>
        )}
        {names.length > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-sm text-muted">
            切換指數
            <select value={name} onChange={(e) => router.push(`/market/index/${encodeURIComponent(e.target.value)}`)}
              className="max-w-56 rounded-md border border-line bg-surface px-2 py-1 text-ink">
              {names.map((x) => <option key={x} value={x}>{label(x)}</option>)}
            </select>
          </label>
        )}
      </div>

      {error && <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-up">指數資料載入失敗：{error}</p>}
      {data && !s && <p className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink">找不到「{asked}」的歷史資料。</p>}

      {stats && (
        <dl className="num mt-4 grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-line bg-surface p-4 text-sm sm:grid-cols-5">
          {([["近 1 月", stats.r1m], ["近 3 月", stats.r3m], ["近 1 年", stats.r1y]] as const).map(([k, x]) => (
            <div key={k}><dt className="text-xs text-muted">{k}</dt><dd className={tone(x)}>{x == null ? "—" : `${sg(x)}${n2(x)}%`}</dd></div>
          ))}
          <div><dt className="text-xs text-muted">52 週最高</dt><dd className="text-ink">{n2(stats.hi)}</dd></div>
          <div><dt className="text-xs text-muted">52 週最低</dt><dd className="text-ink">{n2(stats.lo)}</dd></div>
        </dl>
      )}

      {s && (
        <div className="mt-4 rounded-lg border border-line bg-surface p-3">
          <div role="radiogroup" aria-label="期間" className="mb-2 inline-flex rounded-md border border-line p-0.5 text-xs">
            {RANGES.map(([l, n]) => (
              <button key={l} type="button" role="radio" aria-checked={range === n} onClick={() => setRange(n)}
                className={`rounded px-2 py-1 ${range === n ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink"}`}>{l}</button>
            ))}
          </div>
          <div ref={box} className="h-[360px] w-full sm:h-[440px]" role="img" aria-label={`${label(name)}走勢圖`} />
          <p className="mt-1 text-xs text-muted">
            {s.o ? "日 K 線，紅漲綠跌。" : "每日收盤走勢。"}拖曳可左右移動。{s.market === "TAIFEX" && "期貨從網站上線起每日累積，歷史較短。"}
          </p>
        </div>
      )}

      <section className="mt-6">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          <h2 className="text-base font-bold text-ink">相關股票</h2>
          <DataStatus snap={snap} error={snapErr} />
        </div>
        {snap && data && !p ? (
          <p className="rounded-lg border border-line bg-surface p-4 text-sm text-muted">這個指數沒有對應的產業股票清單。</p>
        ) : (
          <>
            {p && breadth && (
              <p className="num mb-2 text-sm text-muted">
                {p.note}，共 {p.rows.length} 檔：<span className="text-up">上漲 {breadth.up}</span>・<span>平盤 {breadth.flat}</span>・
                <span className="text-down">下跌 {breadth.down}</span>・成交金額 {n2(breadth.value / 1e8)} 億
              </p>
            )}
            <Results key={name} rows={p?.rows ?? []} cols={["close", "chg_pct", "volume_lots", "value", "market_cap", "pe", "foreign_net", "trust_net"]}
              sort={sort} setSort={setSort} loading={!snap} csvName={`${label(name)}_${snap?.meta.asof ?? ""}`} countLabel="共" />
          </>
        )}
      </section>
    </div>
  );
}
