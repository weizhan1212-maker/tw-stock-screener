"use client";

/**
 * K 線圖（TradingView lightweight-charts）：
 * 上：K 棒＋均線（5／20／60）；中：成交量；下：KD 或 MACD。
 * 台股紅漲綠跌；可切換日／週／月、原始價／還原價。滑過圖表時上方圖例顯示該根數值。
 */
import {
  CandlestickSeries, ColorType, createChart, HistogramSeries, type IChartApi, LineSeries, type MouseEventParams,
  type Time,
} from "lightweight-charts";
import { useEffect, useMemo, useRef, useState } from "react";
import { aggregate, type Bar, dailyBars, kd, macd, type Period, sma, type StockFile } from "@/lib/stock";

const MA = [
  { n: 5, light: "#2a78d6", dark: "#3987e5" },
  { n: 20, light: "#eda100", dark: "#c98500" },
  { n: 60, light: "#4a3aa7", dark: "#9085e9" },
];

function css(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function useTheme() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const read = () => setDark(document.documentElement.dataset.theme === "dark");
    read();
    const obs = new MutationObserver(read);
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => obs.disconnect();
  }, []);
  return dark;
}

const fmt = (x: number | null | undefined, d = 2) =>
  x == null || Number.isNaN(x) ? "—" : x.toLocaleString("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });

function Seg<T extends string>({ value, options, onChange, label }: {
  value: T; options: [T, string][]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line bg-surface p-0.5 text-xs">
      {options.map(([v, l]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)}
          className={`rounded px-2 py-1 ${value === v ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink"}`}>
          {l}
        </button>
      ))}
    </div>
  );
}

export default function KChart({ s }: { s: StockFile }) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const dark = useTheme();
  const [period, setPeriod] = useState<Period>("D");
  const [adjusted, setAdjusted] = useState(false);
  const [ind, setInd] = useState<"KD" | "MACD">("KD");
  const [hover, setHover] = useState<number | null>(null);

  const bars = useMemo(() => aggregate(dailyBars(s, adjusted), period), [s, adjusted, period]);
  const calc = useMemo(() => {
    const c = bars.map((b) => b.c);
    return { ma: MA.map((m) => sma(c, m.n)), kd: kd(bars), macd: macd(bars) };
  }, [bars]);

  useEffect(() => {
    const el = box.current;
    if (!el || !bars.length) return;
    const up = css("--up"), down = css("--down"), ink = css("--muted"), line = css("--line"), surface = css("--surface");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: surface }, textColor: ink, fontSize: 11,
        fontFamily: "'Noto Sans TC', system-ui, sans-serif", panes: { separatorColor: line } },
      grid: { vertLines: { visible: false }, horzLines: { color: line } },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, rightOffset: 3 },
      crosshair: { mode: 0 },
      // 滾輪留給整頁捲動；拖曳可平移、雙指可縮放；手機上下滑動照常捲頁
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      localization: { locale: "zh-TW", dateFormat: "yyyy/MM/dd" },
    });
    chartRef.current = chart;
    const t = (b: Bar) => b.t as Time;
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
      priceLineVisible: false,
    });
    candle.setData(bars.map((b) => ({ time: t(b), open: b.o, high: b.h, low: b.l, close: b.c })));
    MA.forEach((m, i) => {
      const ser = chart.addSeries(LineSeries, { color: dark ? m.dark : m.light, lineWidth: 2, priceLineVisible: false,
        lastValueVisible: false, crosshairMarkerVisible: false });
      ser.setData(bars.flatMap((b, j) => (calc.ma[i][j] == null ? [] : [{ time: t(b), value: calc.ma[i][j] as number }])));
    });
    const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    vol.setData(bars.map((b, j) => ({ time: t(b), value: b.v, color: j > 0 && b.c < bars[j - 1].c ? down : up })));
    if (ind === "KD") {
      const k = chart.addSeries(LineSeries, { color: dark ? MA[0].dark : MA[0].light, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 2);
      const d = chart.addSeries(LineSeries, { color: dark ? MA[1].dark : MA[1].light, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 2);
      k.setData(bars.flatMap((b, j) => (calc.kd.k[j] == null ? [] : [{ time: t(b), value: calc.kd.k[j] as number }])));
      d.setData(bars.flatMap((b, j) => (calc.kd.d[j] == null ? [] : [{ time: t(b), value: calc.kd.d[j] as number }])));
    } else {
      const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 2);
      h.setData(bars.map((b, j) => ({ time: t(b), value: calc.macd.hist[j], color: calc.macd.hist[j] >= 0 ? up : down })));
      const dif = chart.addSeries(LineSeries, { color: dark ? MA[0].dark : MA[0].light, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 2);
      const dea = chart.addSeries(LineSeries, { color: dark ? MA[1].dark : MA[1].light, lineWidth: 2, priceLineVisible: false, lastValueVisible: false }, 2);
      dif.setData(bars.map((b, j) => ({ time: t(b), value: calc.macd.dif[j] })));
      dea.setData(bars.map((b, j) => ({ time: t(b), value: calc.macd.dea[j] })));
    }
    const panes = chart.panes();
    panes[0]?.setStretchFactor(0.6);
    panes[1]?.setStretchFactor(0.17);
    panes[2]?.setStretchFactor(0.23);
    const show = period === "D" ? 120 : period === "W" ? 104 : 48;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - show), to: bars.length + 2 });
    const index = new Map(bars.map((b, j) => [b.t, j]));
    const onMove = (p: MouseEventParams) => setHover(p.time ? (index.get(String(p.time)) ?? null) : null);
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, [bars, calc, ind, dark, period]);

  const i = hover ?? bars.length - 1;
  const b = bars[i];
  const prev = bars[i - 1];
  const chg = b && prev ? ((b.c / prev.c) - 1) * 100 : null;

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Seg label="週期" value={period} onChange={setPeriod} options={[["D", "日"], ["W", "週"], ["M", "月"]]} />
        <Seg label="價格" value={adjusted ? "adj" : "raw"} onChange={(v) => setAdjusted(v === "adj")}
          options={[["raw", "原始價"], ["adj", "還原價"]]} />
        <Seg label="副圖指標" value={ind} onChange={setInd} options={[["KD", "KD"], ["MACD", "MACD"]]} />
      </div>
      {b && (
        <div className="num mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          <span className="text-ink">{b.t.replaceAll("-", "/")}</span>
          <span>開 <b className="font-medium text-ink">{fmt(b.o)}</b></span>
          <span>高 <b className="font-medium text-ink">{fmt(b.h)}</b></span>
          <span>低 <b className="font-medium text-ink">{fmt(b.l)}</b></span>
          <span>收 <b className="font-medium text-ink">{fmt(b.c)}</b></span>
          {chg != null && <span className={chg > 0 ? "text-up" : chg < 0 ? "text-down" : ""}>{chg > 0 ? "+" : ""}{fmt(chg)}%</span>}
          <span>量 <b className="font-medium text-ink">{fmt(b.v, 0)}</b> 張</span>
          {MA.map((m, j) => (
            <Key key={m.n} color={dark ? m.dark : m.light} label={`MA${m.n}`} value={fmt(calc.ma[j][i])} />
          ))}
          {ind === "KD" ? (
            <>
              <Key color={dark ? MA[0].dark : MA[0].light} label="K" value={fmt(calc.kd.k[i])} />
              <Key color={dark ? MA[1].dark : MA[1].light} label="D" value={fmt(calc.kd.d[i])} />
            </>
          ) : (
            <>
              <Key color={dark ? MA[0].dark : MA[0].light} label="DIF" value={fmt(calc.macd.dif[i])} />
              <Key color={dark ? MA[1].dark : MA[1].light} label="訊號線" value={fmt(calc.macd.dea[i])} />
            </>
          )}
        </div>
      )}
      <div ref={box} className="h-[420px] w-full sm:h-[520px]" aria-label="K 線圖" role="img" />
      <p className="mt-1 text-xs text-muted">
        拖曳圖表可左右移動，拖曳右側價格軸可縮放。{adjusted && "還原價：把除權息、減資的影響補回，適合看長期漲跌；最新一天與原始價相同。"}
      </p>
    </div>
  );
}

function Key({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <i aria-hidden className="inline-block h-0.5 w-3 rounded" style={{ background: color }} />
      {label} <b className="font-medium text-ink">{value}</b>
    </span>
  );
}
