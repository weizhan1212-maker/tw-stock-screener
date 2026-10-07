"use client";

/** 多股比較：最多 6 檔，走勢疊圖（還原價、起點＝100）、指標對照表、多圖 K 線。 */
import { CandlestickSeries, ColorType, createChart, LineSeries, type Time } from "lightweight-charts";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import DataStatus from "@/components/DataStatus";
import { Seg } from "@/components/Screener";
import { useSnapshot } from "@/hooks/useSnapshot";
import { FIELD_MAP } from "@/lib/fields";
import { fmt, isSigned, type Row } from "@/lib/screener";
import { type Bar, dailyBars, type StockFile } from "@/lib/stock";

const MAX = 6;
// 不用紅綠（紅綠代表漲跌），深淺色都看得清楚
const COLORS = ["#2563eb", "#d97706", "#7c3aed", "#0891b2", "#db2777", "#64748b"];
const RANGES: [string, string, number][] = [["3m", "3 個月", 66], ["6m", "6 個月", 125], ["1y", "1 年", 250], ["3y", "3 年", 750]];
const METRICS = ["close", "chg_pct", "ret20", "ret60", "ret240", "market_cap", "avg_value20", "atr_pct", "pe", "pb", "dividend_yield",
  "eps_ttm", "roe", "gross_margin", "rev_yoy", "eps_q_yoy", "debt_ratio", "health_score", "foreign_ratio", "inst_amt20", "rs60"];

const css = (n: string) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const baseOpts = () => ({
  autoSize: true,
  layout: { background: { type: ColorType.Solid, color: css("--surface") }, textColor: css("--muted"), fontSize: 11, fontFamily: "'Noto Sans TC', system-ui, sans-serif" },
  grid: { vertLines: { visible: false }, horzLines: { color: css("--line") } },
  rightPriceScale: { borderVisible: false }, timeScale: { borderVisible: false },
  handleScroll: false as const, handleScale: false as const,
  localization: { locale: "zh-TW", dateFormat: "yyyy/MM/dd" },
});

export default function Compare() {
  const q = useSearchParams();
  const { snap, error } = useSnapshot();
  const [codes, setCodes] = useState<string[]>(() => (q.get("codes") ?? "").split(",").map((c) => c.trim().toUpperCase()).filter((c) => /^[0-9A-Z]{4,6}$/.test(c)).slice(0, MAX));
  const [range, setRange] = useState("1y");
  const [files, setFiles] = useState<Record<string, StockFile | "err">>({});
  const [add, setAdd] = useState("");

  useEffect(() => {
    window.history.replaceState(null, "", codes.length ? `?codes=${codes.join(",")}` : "?");
    document.title = "多股比較｜股見未來";
    for (const c of codes) {
      if (files[c]) continue;
      fetch(`/api/stock/${c}`).then((r) => (r.ok ? r.json() : Promise.reject())).then((j) => setFiles((f) => ({ ...f, [c]: j })))
        .catch(() => setFiles((f) => ({ ...f, [c]: "err" })));
    }
  }, [codes, files]);

  const by = useMemo(() => new Map((snap?.rows ?? []).map((r) => [r.code as string, r])), [snap]);
  const matches = useMemo(() => {
    const t = add.trim().toLowerCase();
    if (!t || !snap) return [];
    return snap.rows.filter((r) => String(r.code).toLowerCase().startsWith(t) || String(r.name).toLowerCase().includes(t)).slice(0, 8);
  }, [add, snap]);
  const n = RANGES.find((r) => r[0] === range)![2];
  const ready = codes.filter((c) => files[c] && files[c] !== "err") as string[];

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h1 className="text-xl font-bold text-ink">多股比較</h1>
        <DataStatus snap={snap} error={error} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {codes.map((c, i) => (
          <span key={c} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-sm text-ink">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: COLORS[i] }} aria-hidden />
            {c} {(by.get(c)?.name as string) ?? ""}{files[c] === "err" && <span className="text-xs text-up">（讀取失敗）</span>}
            <button type="button" aria-label={`移除 ${c}`} onClick={() => setCodes(codes.filter((x) => x !== c))} className="ml-1 text-muted hover:text-up">×</button>
          </span>
        ))}
        {codes.length < MAX && (
          <div className="relative">
            <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="加入代號或名稱" aria-label="加入比較"
              className="w-44 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink" />
            {matches.length > 0 && (
              <ul className="absolute left-0 top-9 z-20 w-64 rounded-lg border border-line bg-surface py-1 text-sm shadow-lg">
                {matches.map((r) => (
                  <li key={r.code as string}>
                    <button type="button" className="w-full px-3 py-1.5 text-left text-ink hover:bg-surface-2"
                      onClick={() => { if (!codes.includes(r.code as string)) setCodes([...codes, r.code as string]); setAdd(""); }}>
                      {r.code as string} {r.name as string}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <span className="ml-auto"><Seg label="期間" value={range} onChange={setRange} options={RANGES.map(([k, l]) => [k, l] as [string, string])} /></span>
      </div>

      {codes.length === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-line p-6 text-sm text-muted">加入 2～6 檔股票或 ETF 開始比較。也可以在自選股頁勾選後一起比較。</p>
      ) : (
        <>
          <Overlay codes={codes} files={files} n={n} />
          <MetricTable codes={codes} by={by} />
          <div className="mt-6 grid gap-3 md:grid-cols-2">
            {ready.map((c) => <MiniK key={c} code={c} name={(by.get(c)?.name as string) ?? ""} s={files[c] as StockFile} n={n} color={COLORS[codes.indexOf(c)]} />)}
          </div>
        </>
      )}
    </div>
  );
}

function Overlay({ codes, files, n }: { codes: string[]; files: Record<string, StockFile | "err">; n: number }) {
  const box = useRef<HTMLDivElement>(null);
  const rets = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of codes) {
      const s = files[c];
      if (!s || s === "err") continue;
      const bars = dailyBars(s, true).slice(-n);
      if (bars.length) out[c] = (bars[bars.length - 1].c / bars[0].c - 1) * 100;
    }
    return out;
  }, [codes, files, n]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const chart = createChart(el, baseOpts());
    codes.forEach((c, i) => {
      const s = files[c];
      if (!s || s === "err") return;
      const bars = dailyBars(s, true).slice(-n);
      if (!bars.length) return;
      const b0 = bars[0].c;
      const ser = chart.addSeries(LineSeries, { color: COLORS[i], lineWidth: 2, priceLineVisible: false, lastValueVisible: true });
      ser.setData(bars.map((b) => ({ time: b.t as Time, value: (b.c / b0) * 100 })));
    });
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [codes, files, n]);
  return (
    <div className="mt-4 rounded-lg border border-line bg-surface p-2">
      <p className="num flex flex-wrap gap-x-4 px-1 text-xs text-muted">
        <span>走勢（還原價，起點＝100）</span>
        {codes.map((c, i) => rets[c] != null && <span key={c} style={{ color: COLORS[i] }}>{c} {rets[c] > 0 ? "+" : ""}{rets[c].toFixed(1)}%</span>)}
      </p>
      <div ref={box} className="h-[300px] w-full sm:h-[380px]" />
    </div>
  );
}

function MetricTable({ codes, by }: { codes: string[]; by: Map<string, Row> }) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th className="px-3 py-2 text-left font-medium">指標</th>
            {codes.map((c, i) => (
              <th key={c} className="px-3 py-2 text-right font-medium">
                <Link href={`/stock/${c}`} className="hover:underline" style={{ color: COLORS[i] }}>{c} {(by.get(c)?.name as string) ?? ""}</Link>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {METRICS.map((k) => {
            const f = FIELD_MAP[k];
            if (!f) return null;
            return (
              <tr key={k} className="border-t border-line">
                <td className="px-3 py-1.5 text-ink">{f.label}</td>
                {codes.map((c) => <td key={c} className="num px-3 py-1.5 text-right text-ink">{fmt(by.get(c)?.[k], f.format, isSigned(k))}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MiniK({ code, name, s, n, color }: { code: string; name: string; s: StockFile; n: number; color: string }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const chart = createChart(el, baseOpts());
    const up = css("--up"), down = css("--down");
    const bars: Bar[] = dailyBars(s, false).slice(-Math.min(n, 250));
    const ser = chart.addSeries(CandlestickSeries, { upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceLineVisible: false });
    ser.setData(bars.map((b) => ({ time: b.t as Time, open: b.o, high: b.h, low: b.l, close: b.c })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [s, n]);
  return (
    <div className="rounded-lg border border-line bg-surface p-2">
      <p className="px-1 text-sm font-bold" style={{ color }}>{code} {name}<span className="ml-2 text-xs font-normal text-muted">日 K（原始價{n > 250 ? "，最多 1 年" : ""}）</span></p>
      <div ref={box} className="h-[240px] w-full" />
    </div>
  );
}
