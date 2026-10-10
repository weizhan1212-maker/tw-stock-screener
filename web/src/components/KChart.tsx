"use client";

/**
 * K 線圖（TradingView lightweight-charts）
 * - 主圖：K 棒＋可選均線（5/10/20/60/120/240）、布林通道
 * - 副圖：可複選成交量、KD、MACD、RSI、乖離率、DMI、威廉指標、OBV、法人買賣超、融資餘額
 * - 畫線：水平線、趨勢線（存在這台瀏覽器）
 * 台股紅漲綠跌；日／週／月；原始價／還原價。滑過圖表時各區左上角顯示該根數值。
 */
import {
  CandlestickSeries, ColorType, createChart, HistogramSeries, type IChartApi, type IPriceLine, type ISeriesApi,
  LineSeries, LineStyle, type MouseEventParams, type Time,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { bias, bollinger, dmi, obv, rsi, smaN, williams } from "@/lib/indicators";
import { aggregate, type Bar, chipSeries, dailyBars, kd, macd, type Period, type StockFile } from "@/lib/stock";

// ---------- 顏色（色盲檢查過；黃、粉、青在淺色底對比較低，圖例一律附數值） ----------
const C = {
  blue: ["#2a78d6", "#3987e5"], pink: ["#e87ba4", "#d55181"], yellow: ["#eda100", "#c98500"],
  violet: ["#4a3aa7", "#9085e9"], aqua: ["#1baf7a", "#199e70"], gray: ["#8b8f97", "#9aa0aa"],
} as const;
type ColorName = keyof typeof C;

const MAS: { n: number; c: ColorName }[] = [
  { n: 5, c: "blue" }, { n: 10, c: "pink" }, { n: 20, c: "yellow" }, { n: 60, c: "violet" }, { n: 120, c: "aqua" }, { n: 240, c: "gray" },
];

type PaneId = "vol" | "kd" | "macd" | "rsi" | "bias" | "dmi" | "wr" | "obv" | "chip" | "margin";
const PANES: { id: PaneId; label: string; help: string }[] = [
  { id: "vol", label: "成交量", help: "每根 K 棒的成交張數，紅色收漲、綠色收跌。" },
  { id: "kd", label: "KD", help: "0–100，K 線穿過 D 線向上叫黃金交叉。80 以上偏熱、20 以下偏冷。" },
  { id: "macd", label: "MACD", help: "DIF 與訊號線；柱狀體為正代表多方動能。" },
  { id: "rsi", label: "RSI", help: "RSI 6 與 12，衡量漲跌力道。70 以上偏熱、30 以下偏冷。" },
  { id: "bias", label: "乖離率", help: "股價離 20 日均線多遠（%）。乖離過大常會拉回。" },
  { id: "dmi", label: "DMI", help: "+DI 大於 −DI 代表多方佔優；ADX 越高代表趨勢越明確。" },
  { id: "wr", label: "威廉指標", help: "0 到 −100。接近 0 代表在近期高檔，接近 −100 在低檔。" },
  { id: "obv", label: "OBV", help: "能量潮：上漲日加成交量、下跌日減成交量，看量能是否支持走勢。" },
  { id: "chip", label: "法人買賣超", help: "外資與投信每期買賣超張數（週／月線為加總）。" },
  { id: "margin", label: "融資餘額", help: "散戶借錢買股的餘額（張），增加太快代表追價。" },
];
const MAX_PANES = 4;

type Drawing = { kind: "h"; price: number; adj: boolean } | { kind: "t"; t1: string; p1: number; t2: string; p2: number; adj: boolean };

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

function useStored<T>(key: string, init: T): [T, (v: T) => void] {
  const [v, setV] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : init;
    } catch {
      return init;
    }
  });
  const set = useCallback((x: T) => {
    setV(x);
    try { localStorage.setItem(key, JSON.stringify(x)); } catch {}
  }, [key]);
  return [v, set];
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

function Popover({ label, children }: { label: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink hover:border-accent">
        {label}<span aria-hidden className="text-[10px] text-muted">▾</span>
      </button>
      {open && <div className="absolute left-0 z-30 mt-1 w-64 rounded-lg border border-line bg-surface p-3 shadow-lg">{children}</div>}
    </div>
  );
}

interface Series { label: string; color: string; values: (number | null)[]; digits?: number }
interface PaneDef { id: PaneId | "main"; title: string; series: Series[] }

export default function KChart({ s }: { s: StockFile }) {
  const box = useRef<HTMLDivElement>(null);
  const dark = useTheme();
  const [period, setPeriod] = useState<Period>("D");
  const [adjusted, setAdjusted] = useState(false);
  const [mas, setMas] = useStored<number[]>("chart:mas", [5, 20, 60]);
  const [boll, setBoll] = useStored<boolean>("chart:boll", false);
  const [panes, setPanes] = useStored<PaneId[]>("chart:panes", ["vol", "kd"]);
  const [drawings, setDrawings] = useStored<Drawing[]>(`draw:${s.code}`, []);
  const [tool, setTool] = useState<"none" | "h" | "t">("none");
  const [moreTools, setMoreTools] = useState(false);          // 手機：指標與畫線工具預設收起
  const [pending, setPending] = useState<{ t: string; p: number } | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [paneTops, setPaneTops] = useState<number[]>([]);

  const bars = useMemo(() => aggregate(dailyBars(s, adjusted), period), [s, adjusted, period]);
  const col = useCallback((c: ColorName) => C[c][dark ? 1 : 0], [dark]);

  // 計算各區要畫的線
  const defs = useMemo<PaneDef[]>(() => {
    const c = bars.map((b) => b.c);
    const main: Series[] = MAS.filter((m) => mas.includes(m.n)).map((m) => ({ label: `MA${m.n}`, color: col(m.c), values: smaN(c, m.n) }));
    if (boll) {
      const b = bollinger(bars);
      main.push({ label: "布林上軌", color: col("gray"), values: b.up }, { label: "布林下軌", color: col("gray"), values: b.lo });
    }
    const out: PaneDef[] = [{ id: "main", title: "", series: main }];
    const chips = panes.some((p) => p === "chip" || p === "margin") ? chipSeries(s, bars, period) : [];
    for (const id of panes) {
      const label = PANES.find((p) => p.id === id)!.label;
      if (id === "vol") out.push({ id, title: label, series: [{ label: "量（張）", color: col("gray"), values: bars.map((b) => b.v), digits: 0 }] });
      if (id === "kd") { const k = kd(bars); out.push({ id, title: label, series: [{ label: "K", color: col("blue"), values: k.k }, { label: "D", color: col("yellow"), values: k.d }] }); }
      if (id === "macd") { const m = macd(bars); out.push({ id, title: label, series: [{ label: "DIF", color: col("blue"), values: m.dif }, { label: "訊號線", color: col("yellow"), values: m.dea }, { label: "柱", color: col("gray"), values: m.hist }] }); }
      if (id === "rsi") out.push({ id, title: label, series: [{ label: "RSI6", color: col("blue"), values: rsi(bars, 6) }, { label: "RSI12", color: col("yellow"), values: rsi(bars, 12) }] });
      if (id === "bias") out.push({ id, title: label, series: [{ label: "乖離 20（%）", color: col("blue"), values: bias(bars, 20) }] });
      if (id === "dmi") { const d = dmi(bars); out.push({ id, title: label, series: [{ label: "+DI", color: col("blue"), values: d.pdi }, { label: "−DI", color: col("pink"), values: d.mdi }, { label: "ADX", color: col("violet"), values: d.adx }] }); }
      if (id === "wr") out.push({ id, title: label, series: [{ label: "%R 14", color: col("blue"), values: williams(bars) }] });
      if (id === "obv") out.push({ id, title: label, series: [{ label: "OBV（張）", color: col("blue"), values: obv(bars), digits: 0 }] });
      if (id === "chip") out.push({ id, title: label, series: [{ label: "外資", color: col("blue"), values: chips.map((x) => x.fi), digits: 0 }, { label: "投信", color: col("yellow"), values: chips.map((x) => x.it), digits: 0 }] });
      if (id === "margin") out.push({ id, title: label, series: [{ label: "融資餘額（張）", color: col("violet"), values: chips.map((x) => x.mb), digits: 0 }] });
    }
    return out;
  }, [bars, mas, boll, panes, s, period, col]);

  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<"Candlestick"> | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || !bars.length) return;
    const up = css("--up"), down = css("--down"), ink = css("--muted"), line = css("--line"), surface = css("--surface");
    const chart = createChart(el, {
      autoSize: true,
      layout: { background: { type: ColorType.Solid, color: surface }, textColor: ink, fontSize: 11,
        fontFamily: "'Noto Sans TC', system-ui, sans-serif", panes: { separatorColor: line } },
      grid: { vertLines: { visible: false }, horzLines: { color: line } },
      rightPriceScale: { borderVisible: false, scaleMargins: { top: 0.12, bottom: 0.08 } },
      timeScale: { borderVisible: false, rightOffset: 3 },
      crosshair: { mode: 0 },
      // 滾輪留給整頁捲動；拖曳可平移、雙指或拖曳價格軸可縮放；手機上下滑動照常捲頁
      handleScroll: { mouseWheel: false, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { mouseWheel: false, pinch: true, axisPressedMouseMove: true, axisDoubleClickReset: true },
      // 座標軸：千分位；1000 元以上不顯示小數（台股升降單位 5 元），其餘兩位
      localization: { locale: "zh-TW", dateFormat: "yyyy/MM/dd",
        priceFormatter: (p: number) => p.toLocaleString("zh-TW", { minimumFractionDigits: Math.abs(p) >= 1000 ? 0 : 2, maximumFractionDigits: Math.abs(p) >= 1000 ? 0 : 2 }) },
    });
    chartRef.current = chart;
    const t = (b: Bar) => b.t as Time;
    const pts = (vals: (number | null)[]) => bars.flatMap((b, j) => (vals[j] == null ? [] : [{ time: t(b), value: vals[j] as number }]));
    const lineOpts = (color: string, style = LineStyle.Solid) => ({ color, lineWidth: 2 as const, lineStyle: style, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });

    const candle = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down, priceLineVisible: false,
    });
    candle.setData(bars.map((b) => ({ time: t(b), open: b.o, high: b.h, low: b.l, close: b.c })));
    candleRef.current = candle;
    defs[0].series.forEach((ser) => chart.addSeries(LineSeries, lineOpts(ser.color, ser.label.startsWith("布林") ? LineStyle.Dashed : LineStyle.Solid)).setData(pts(ser.values)));

    defs.slice(1).forEach((p, k) => {
      const pane = k + 1;
      if (p.id === "vol") {
        const h = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, pane);
        h.setData(bars.map((b, j) => ({ time: t(b), value: b.v, color: j > 0 && b.c < bars[j - 1].c ? down : up })));
      } else if (p.id === "macd") {
        const h = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, pane);
        h.setData(bars.map((b, j) => ({ time: t(b), value: p.series[2].values[j] ?? 0, color: (p.series[2].values[j] ?? 0) >= 0 ? up : down })));
        p.series.slice(0, 2).forEach((ser) => chart.addSeries(LineSeries, lineOpts(ser.color), pane).setData(pts(ser.values)));
      } else if (p.id === "chip") {
        p.series.forEach((ser) => {
          const h = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false, color: ser.color }, pane);
          h.setData(pts(ser.values));
        });
      } else {
        p.series.forEach((ser) => chart.addSeries(LineSeries, lineOpts(ser.color), pane).setData(pts(ser.values)));
      }
    });

    // 畫線
    const lines: IPriceLine[] = [];
    const idxOf = (date: string) => { const i = bars.findIndex((b) => b.t >= date); return i < 0 ? bars.length - 1 : i; };
    drawings.filter((d) => d.adj === adjusted).forEach((d) => {
      if (d.kind === "h") {
        lines.push(candle.createPriceLine({ price: d.price, color: css("--accent"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" }));
      } else {
        const a = idxOf(d.t1), b = idxOf(d.t2);
        if (a === b) return;
        const [i1, p1, i2, p2] = a < b ? [a, d.p1, b, d.p2] : [b, d.p2, a, d.p1];
        chart.addSeries(LineSeries, { ...lineOpts(css("--accent")), lineWidth: 2 }).setData([
          { time: bars[i1].t as Time, value: p1 }, { time: bars[i2].t as Time, value: p2 },
        ]);
      }
    });

    const panesApi = chart.panes();
    const rest = defs.length - 1;
    panesApi[0]?.setStretchFactor(rest ? 0.58 : 1);
    panesApi.slice(1).forEach((p) => p.setStretchFactor(rest ? 0.42 / rest : 0));
    const show = period === "D" ? 120 : period === "W" ? 104 : 48;
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, bars.length - show), to: bars.length + 2 });

    const index = new Map(bars.map((b, j) => [b.t, j]));
    const onMove = (p: MouseEventParams) => setHover(p.time ? (index.get(String(p.time)) ?? null) : null);
    chart.subscribeCrosshairMove(onMove);
    const measure = () => {
      let top = 0;
      setPaneTops(chart.panes().map((p) => { const t0 = top; top += p.getHeight() + 1; return t0; }));
    };
    requestAnimationFrame(measure);
    const ro = new ResizeObserver(() => requestAnimationFrame(measure));
    ro.observe(el);
    return () => {
      ro.disconnect();
      chart.unsubscribeCrosshairMove(onMove);
      lines.forEach((l) => candle.removePriceLine(l));
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
    };
  }, [bars, defs, dark, period, drawings, adjusted]);

  // 畫線工具：點圖表（第一點存在 ref，連點也不會漏掉第二點）
  const pendingRef = useRef<{ t: string; p: number } | null>(null);
  useEffect(() => {
    const chart = chartRef.current, candle = candleRef.current;
    if (!chart || !candle || tool === "none") return;
    const onClick = (p: MouseEventParams) => {
      if (!p.point || !p.time) return;
      const price = candle.coordinateToPrice(p.point.y);
      if (price == null) return;
      const t = String(p.time);
      if (tool === "h") {
        setDrawings([...drawings, { kind: "h", price: Number(price), adj: adjusted }]);
        setTool("none");
      } else if (!pendingRef.current) {
        pendingRef.current = { t, p: Number(price) };
        setPending(pendingRef.current);
      } else {
        const a = pendingRef.current;
        pendingRef.current = null;
        setPending(null);
        setDrawings([...drawings, { kind: "t", t1: a.t, p1: a.p, t2: t, p2: Number(price), adj: adjusted }]);
        setTool("none");
      }
    };
    chart.subscribeClick(onClick);
    return () => chart.unsubscribeClick(onClick);
  }, [tool, drawings, adjusted, setDrawings, bars, defs]);

  const i = hover ?? bars.length - 1;
  const b = bars[i];
  const prev = bars[i - 1];
  const chg = b && prev ? ((b.c / prev.c) - 1) * 100 : null;
  const visible = drawings.filter((d) => d.adj === adjusted).length;

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Seg label="週期" value={period} onChange={setPeriod} options={[["D", "日"], ["W", "週"], ["M", "月"]]} />
        <Seg label="價格" value={adjusted ? "adj" : "raw"} onChange={(v) => setAdjusted(v === "adj")} options={[["raw", "原始價"], ["adj", "還原價"]]} />
        {/* 手機只顯示週期與還原價；指標與畫線收進「更多」 */}
        <button type="button" onClick={() => setMoreTools((v) => !v)} aria-expanded={moreTools}
          className="ml-auto rounded-md border border-line px-2 py-1 text-xs text-muted lg:hidden">{moreTools ? "收起" : "指標・畫線"}</button>
        <div className={`${moreTools ? "flex" : "hidden"} w-full flex-wrap items-center gap-2 lg:flex lg:w-auto`}>
        <Popover label="主圖指標">
          <fieldset>
            <legend className="mb-1.5 text-xs text-muted">均線</legend>
            <div className="grid grid-cols-3 gap-1.5 text-sm">
              {MAS.map((m) => (
                <label key={m.n} className="flex items-center gap-1.5 text-ink">
                  <input type="checkbox" checked={mas.includes(m.n)}
                    onChange={(e) => setMas(e.target.checked ? [...mas, m.n].sort((a, z) => a - z) : mas.filter((x) => x !== m.n))} />
                  MA{m.n}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="mt-3 flex items-center gap-1.5 text-sm text-ink">
            <input type="checkbox" checked={boll} onChange={(e) => setBoll(e.target.checked)} />布林通道（20, 2）
          </label>
        </Popover>
        <Popover label={`副圖（${panes.length}）`}>
          <p className="mb-2 text-xs text-muted">最多同時 {MAX_PANES} 個，依勾選順序排列。</p>
          <ul className="space-y-1.5">
            {PANES.map((p) => {
              const on = panes.includes(p.id);
              return (
                <li key={p.id}>
                  <label className="flex items-start gap-1.5 text-sm text-ink">
                    <input type="checkbox" className="mt-1" checked={on} disabled={!on && panes.length >= MAX_PANES}
                      onChange={(e) => setPanes(e.target.checked ? [...panes, p.id] : panes.filter((x) => x !== p.id))} />
                    <span>{p.label}<span className="block text-xs leading-snug text-muted">{p.help}</span></span>
                  </label>
                </li>
              );
            })}
          </ul>
        </Popover>
        <div className="inline-flex items-center gap-1 rounded-md border border-line bg-surface p-0.5 text-xs" role="group" aria-label="畫線工具">
          <button type="button" aria-pressed={tool === "h"} onClick={() => { setTool(tool === "h" ? "none" : "h"); setPending(null); pendingRef.current = null; }}
            className={`rounded px-2 py-1 ${tool === "h" ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink"}`}>水平線</button>
          <button type="button" aria-pressed={tool === "t"} onClick={() => { setTool(tool === "t" ? "none" : "t"); setPending(null); pendingRef.current = null; }}
            className={`rounded px-2 py-1 ${tool === "t" ? "bg-accent-soft font-medium text-accent" : "text-muted hover:text-ink"}`}>趨勢線</button>
          <button type="button" disabled={!drawings.length} onClick={() => setDrawings(drawings.slice(0, -1))}
            className="rounded px-2 py-1 text-muted hover:text-ink disabled:opacity-40">復原</button>
          <button type="button" disabled={!drawings.length} onClick={() => setDrawings([])}
            className="rounded px-2 py-1 text-muted hover:text-ink disabled:opacity-40">清除</button>
        </div>
        </div>
      </div>
      {tool !== "none" && (
        <p className="mb-1 rounded bg-accent-soft px-2 py-1 text-xs text-accent">
          {tool === "h" ? "在 K 線圖上點一下要畫水平線的價位。" : pending ? "再點一下趨勢線的第二個點。" : "在 K 線圖上點趨勢線的第一個點。"}
        </p>
      )}
      {b && (
        <div className="num mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
          <span className="text-ink">{b.t.replaceAll("-", "/")}</span>
          <span>開 <b className="font-medium text-ink">{fmt(b.o)}</b></span>
          <span>高 <b className="font-medium text-ink">{fmt(b.h)}</b></span>
          <span>低 <b className="font-medium text-ink">{fmt(b.l)}</b></span>
          <span>收 <b className="font-medium text-ink">{fmt(b.c)}</b></span>
          {chg != null && <span className={chg > 0 ? "text-up" : chg < 0 ? "text-down" : ""}>{chg > 0 ? "+" : ""}{fmt(chg)}%</span>}
          <span>量 <b className="font-medium text-ink">{fmt(b.v, 0)}</b> 張</span>
          {defs[0].series.map((ser) => <Key key={ser.label} color={ser.color} label={ser.label} value={fmt(ser.values[i], ser.digits ?? 2)} />)}
        </div>
      )}
      <div className="relative">
        <div ref={box} className={`w-full ${defs.length > 3 ? "h-[560px] sm:h-[680px]" : "h-[440px] sm:h-[540px]"} ${tool !== "none" ? "cursor-crosshair" : ""}`}
          aria-label="K 線圖" role="img" />
        {/* 各副圖左上角的圖例 */}
        {defs.slice(1).map((p, k) => paneTops[k + 1] != null && (
          <div key={p.id} className="num pointer-events-none absolute left-1 z-10 flex flex-wrap gap-x-2 rounded bg-surface/80 px-1 text-[11px] text-muted"
            style={{ top: paneTops[k + 1] + 2 }}>
            <span className="text-ink">{p.title}</span>
            {p.series.filter((ser) => !(p.id === "vol" || (p.id === "macd" && ser.label === "柱"))).map((ser) => (
              <Key key={ser.label} color={ser.color} label={ser.label} value={fmt(ser.values[i], ser.digits ?? 2)} />
            ))}
          </div>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted">
        拖曳圖表可左右移動，拖曳右側價格軸可縮放。{visible > 0 && `已畫 ${visible} 條線（存在這台瀏覽器）。`}
        {adjusted && "還原價：把除權息、減資的影響補回，適合看長期漲跌；最新一天與原始價相同。"}
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
