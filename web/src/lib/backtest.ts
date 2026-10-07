/**
 * 回測引擎（在瀏覽器裡跑）。規則見 docs/需求規格書.md 2.C 與 D15：
 * - 每月（或每季）最後一個交易日收盤後選股，下一個交易日「開盤價」成交，等權重
 * - 手續費 0.1425%（可打折）、證交稅 0.3%（賣出）、滑價 0.1%（買賣各一次）
 * - 用向前還原價（股利再投入）；該期 0 檔符合就持有現金
 * - 已下市／停牌：沿用最後收盤價，下次換股時以該價格出場
 * - 基準：加權股價報酬指數（含息）
 */
import { decode, type RawSnapshot, type Row } from "./screener";

export interface BtMonth { month: string; signal: string; exec: string }
export interface BtIndex { months: BtMonth[]; years: number[]; first_day: string; last_day: string; pending: number; generated_at: string }
interface PxFile { year: number; dates: string[]; codes: string[]; close: (number | null)[][]; open: Record<string, (number | null)[]>; bench: (number | null)[] }

export interface Prices {
  dates: string[];
  codeIdx: Map<string, number>;
  /** close[code][day]：向前還原收盤價，沒交易的日子沿用前一天 */
  close: Float32Array[];
  /** 成交日的還原開盤價 */
  open: Map<string, Map<number, number>>;
  bench: (number | null)[];
}

export interface BtData { index: BtIndex; snaps: Map<string, { meta: Record<string, unknown>; rows: Row[] }>; prices: Prices }

const cache = new Map<string, Promise<unknown>>();
function getJson<T>(url: string): Promise<T> {
  if (!cache.has(url)) {
    cache.set(url, fetch(url).then(async (r) => {
      if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? `HTTP ${r.status}`);
      return r.json();
    }).catch((e) => { cache.delete(url); throw e; }));
  }
  return cache.get(url) as Promise<T>;
}

export const loadIndex = () => getJson<BtIndex>("/api/bt/index.json");

/** 載入指定月份範圍需要的快照與價格（同一個分頁只下載一次）。 */
export async function loadData(index: BtIndex, months: BtMonth[], onProgress?: (done: number, total: number) => void): Promise<BtData> {
  const first = months[0].exec.slice(0, 4);
  const years = index.years.filter((y) => String(y) >= first);
  const total = months.length + years.length;
  let done = 0;
  const tick = <T,>(p: Promise<T>) => p.then((x) => { onProgress?.(++done, total); return x; });
  const [snapList, pxList] = await Promise.all([
    Promise.all(months.map((m) => tick(getJson<RawSnapshot>(`/api/bt/snap/${m.month}.json.gz`)))),
    Promise.all(years.map((y) => tick(getJson<PxFile>(`/api/bt/px/${y}.json.gz`)))),
  ]);
  const snaps = new Map(months.map((m, i) => {
    const d = decode(snapList[i]);
    return [m.month, { meta: d.meta as unknown as Record<string, unknown>, rows: d.rows }];
  }));
  return { index, snaps, prices: mergePrices(pxList) };
}

const pxCache = new WeakMap<PxFile[], Prices>();
function mergePrices(files: PxFile[]): Prices {
  if (pxCache.has(files)) return pxCache.get(files)!;
  const dates = files.flatMap((f) => f.dates);
  const codeIdx = new Map<string, number>();
  for (const f of files) for (const c of f.codes) if (!codeIdx.has(c)) codeIdx.set(c, codeIdx.size);
  const close = Array.from({ length: codeIdx.size }, () => new Float32Array(dates.length).fill(NaN));
  const open = new Map<string, Map<number, number>>();
  let off = 0;
  for (const f of files) {
    const ci = f.codes.map((c) => codeIdx.get(c)!);
    f.close.forEach((row, t) => row.forEach((v, j) => { if (v != null) close[ci[j]][off + t] = v; }));
    for (const [d, row] of Object.entries(f.open)) {
      const m = new Map<number, number>();
      row.forEach((v, j) => { if (v != null) m.set(ci[j], v); });
      open.set(d, m);
    }
    off += f.dates.length;
  }
  for (const a of close) for (let t = 1; t < a.length; t++) if (Number.isNaN(a[t])) a[t] = a[t - 1];   // 停牌沿用前價
  const p = { dates, codeIdx, close, open, bench: files.flatMap((f) => f.bench) };
  pxCache.set(files, p);
  return p;
}

// ---------------- 模擬 ----------------

export interface BtSettings {
  years: number;            // 回測年數（0 = 全部）
  freq: "month" | "quarter";
  maxHold: number;          // 持股上限（等權重）
  feeDiscount: number;      // 手續費折數，1 = 不打折
}
export const DEFAULT_SETTINGS: BtSettings = { years: 3, freq: "month", maxHold: 20, feeDiscount: 1 };

const FEE = 0.001425, TAX = 0.003, SLIP = 0.001, RF = 0.01;

/** 依設定挑出要換股的月份 */
export function pickMonths(all: BtMonth[], s: BtSettings): BtMonth[] {
  let ms = all;
  if (s.years > 0 && ms.length) {
    const last = ms[ms.length - 1].signal;
    const cut = `${Number(last.slice(0, 4)) - s.years}${last.slice(4)}`;
    ms = ms.filter((m) => m.signal >= cut);
  }
  if (s.freq === "quarter") ms = ms.filter((m) => ["03", "06", "09", "12"].includes(m.month.slice(5)));
  return ms;
}

export interface Holding { code: string; name: string; weight: number }
export interface Period { month: string; exec: string; picks: Holding[]; matched: number; ret: number | null }
export interface Trade { date: string; code: string; name: string; side: "買進" | "賣出" | "加碼" | "減碼"; pct: number }
export interface BtResult {
  dates: string[]; equity: number[]; bench: number[];
  periods: Period[]; trades: Trade[];
  stats: Stats; benchStats: Stats;
  yearly: { year: string; ret: number; bench: number | null }[];
  turnover: number; avgHold: number; costPct: number;
}
export interface Stats { total: number; cagr: number; mdd: number; vol: number; sharpe: number | null; winMonth: number | null }

/** select：給某一期的快照列，回傳依優先順序排好的股票（引擎會取前 maxHold 檔有成交價的） */
export function simulate(data: BtData, months: BtMonth[], s: BtSettings, select: (rows: Row[], meta: Record<string, unknown>) => Row[]): BtResult {
  const P = data.prices;
  const dayIdx = new Map(P.dates.map((d, i) => [d, i]));
  const buyCost = FEE * s.feeDiscount + SLIP, sellCost = FEE * s.feeDiscount + TAX + SLIP;
  const start = dayIdx.get(months[0].exec)!;
  const execAt = new Map(months.map((m) => [dayIdx.get(m.exec)!, m]));
  let cash = 1;
  let pos = new Map<number, number>();           // code index → 股數（以還原價計）
  const names = new Map<number, string>();
  const codes = [...P.codeIdx.keys()];             // index → 代號
  const startVal: number[] = [];
  const equity: number[] = [], dates: string[] = [], bench: number[] = [];
  const periods: Period[] = [], trades: Trade[] = [];
  let turnover = 0, costPaid = 0, holdSum = 0;
  const b0 = firstNum(P.bench, start - 1) ?? firstNum(P.bench, start);
  let lastVal = 1;

  for (let t = start; t < P.dates.length; t++) {
    const m = execAt.get(t);
    if (m) {
      const snap = data.snaps.get(m.month);
      const openMap = P.open.get(m.exec) ?? new Map();
      const px = (i: number) => openMap.get(i) ?? lastPx(P.close[i], t - 1);
      const ranked = snap ? select(snap.rows, snap.meta) : [];
      const pick: number[] = [];
      for (const r of ranked) {
        const i = P.codeIdx.get(r.code as string);
        if (i == null || !openMap.has(i)) continue;     // 成交日沒開盤價（停牌）就跳過
        if (!pick.includes(i)) { pick.push(i); names.set(i, r.name as string); }
        if (pick.length >= s.maxHold) break;
      }
      const V = cash + [...pos].reduce((a, [i, q]) => a + q * px(i), 0);
      // 目標：每檔 T 元；扣掉交易成本後重算兩次
      let T = pick.length ? V / pick.length : 0;
      for (let k = 0; k < 2 && pick.length; k++) {
        let cost = 0;
        for (const i of new Set([...pos.keys(), ...pick])) {
          const cur = (pos.get(i) ?? 0) * px(i), tgt = pick.includes(i) ? T : 0, d = tgt - cur;
          cost += d > 0 ? d * buyCost : -d * sellCost;
        }
        T = (V - cost) / pick.length;
      }
      const next = new Map<number, number>();
      let traded = 0, cost = 0;
      for (const i of new Set([...pos.keys(), ...pick])) {
        const p = px(i), cur = (pos.get(i) ?? 0) * p, tgt = pick.includes(i) ? T : 0, d = tgt - cur;
        if (tgt > 0) next.set(i, tgt / p);
        traded += Math.abs(d);
        cost += d > 0 ? d * buyCost : -d * sellCost;
        const side = cur === 0 ? "買進" : tgt === 0 ? "賣出" : d > 0 ? "加碼" : "減碼";
        if (side === "買進" || side === "賣出" || Math.abs(d) / V >= 0.005) {
          trades.push({ date: m.exec, code: codes[i], name: names.get(i) ?? "", pct: (Math.abs(d) / V) * 100, side });
        }
      }
      const invested = [...next].reduce((a, [i, q]) => a + q * px(i), 0);
      cash = V - invested - cost;
      if (Math.abs(cash) < 1e-12) cash = 0;
      pos = next;
      turnover += traded / V / 2;
      costPaid += cost / V;
      holdSum += pick.length;
      if (periods.length) periods[periods.length - 1].ret = (V / startVal[startVal.length - 1] - 1) * 100;
      startVal.push(V);
      periods.push({ month: m.month, exec: m.exec, matched: ranked.length, ret: null,
        picks: pick.map((i) => ({ code: codes[i], name: names.get(i) ?? "", weight: 100 / pick.length })) });
    }
    const val = cash + [...pos].reduce((a, [i, q]) => a + q * lastPx(P.close[i], t), 0);
    lastVal = val;
    dates.push(P.dates[t]);
    equity.push(val);
    const b = P.bench[t];
    bench.push(b != null && b0 ? b / b0 : bench[bench.length - 1] ?? 1);
  }
  if (periods.length) periods[periods.length - 1].ret = (lastVal / startVal[startVal.length - 1] - 1) * 100;

  return {
    dates, equity, bench, periods, trades: trades.reverse(),
    stats: stats(dates, equity), benchStats: stats(dates, bench),
    yearly: yearly(dates, equity, bench),
    turnover: periods.length ? (turnover / periods.length) * 100 : 0,
    avgHold: periods.length ? holdSum / periods.length : 0,
    costPct: costPaid * 100,
  };
}

function lastPx(a: Float32Array, t: number): number {
  for (let k = t; k >= 0; k--) if (!Number.isNaN(a[k])) return a[k];
  return 0;
}
function firstNum(a: (number | null)[], t: number): number | null {
  for (let k = Math.max(0, t); k < a.length; k++) if (a[k] != null) return a[k];
  return null;
}

export function stats(dates: string[], eq: number[]): Stats {
  const n = eq.length;
  if (n < 2) return { total: 0, cagr: 0, mdd: 0, vol: 0, sharpe: null, winMonth: null };
  const total = (eq[n - 1] / eq[0] - 1) * 100;
  const days = (Date.parse(dates[n - 1]) - Date.parse(dates[0])) / 86400000;
  const cagr = (Math.pow(eq[n - 1] / eq[0], 365 / Math.max(days, 1)) - 1) * 100;
  let peak = eq[0], mdd = 0;
  const rets: number[] = [];
  for (let i = 0; i < n; i++) {
    peak = Math.max(peak, eq[i]);
    mdd = Math.min(mdd, eq[i] / peak - 1);
    if (i) rets.push(eq[i] / eq[i - 1] - 1);
  }
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(rets.length - 1, 1));
  const vol = sd * Math.sqrt(252) * 100;
  const sharpe = sd > 0 ? (mean * 252 - RF) / (sd * Math.sqrt(252)) : null;
  // 月勝率：每個月月底對上個月月底上漲的比例
  const monthEnd: number[] = [];
  for (let i = 1; i < n; i++) if (i === n - 1 || dates[i + 1].slice(0, 7) !== dates[i].slice(0, 7)) monthEnd.push(eq[i]);
  let win = 0, cnt = 0, prev = eq[0];
  for (const v of monthEnd) { cnt++; if (v > prev) win++; prev = v; }
  return { total, cagr, mdd: mdd * 100, vol, sharpe, winMonth: cnt ? (win / cnt) * 100 : null };
}

function yearly(dates: string[], eq: number[], bench: number[]) {
  const out: { year: string; ret: number; bench: number | null }[] = [];
  let y = dates[0]?.slice(0, 4), e0 = eq[0], b0 = bench[0];
  for (let i = 0; i < dates.length; i++) {
    const last = i === dates.length - 1 || dates[i + 1].slice(0, 4) !== y;
    if (last) {
      out.push({ year: y, ret: (eq[i] / e0 - 1) * 100, bench: b0 ? (bench[i] / b0 - 1) * 100 : null });
      if (i < dates.length - 1) { y = dates[i + 1].slice(0, 4); e0 = eq[i]; b0 = bench[i]; }
    }
  }
  return out;
}
