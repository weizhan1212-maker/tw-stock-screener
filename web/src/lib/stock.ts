/** 個股頁：資料型別、K 線換算（日／週／月、原始／還原）、技術指標、支撐壓力、多空判斷、焦點排名、健康評級。 */
import { num, type Row } from "./screener";

export interface StockFile {
  code: string;
  asof: string;
  info: { name: string; market: string; sec_type: "stock" | "etf" | null; industry?: string; listed?: string | null; capital?: number | null; shares?: number | null };
  daily: { d: string[]; o: N[]; h: N[]; l: N[]; c: N[]; v: N[]; f: N[]; fi: N[]; it: N[]; dl: N[]; mb: N[]; sb: N[] };
  revenue?: [string, N][];
  quarters?: { p: string; rev: N; eps: N; gm: N; om: N; nm: N; roe: N }[];
  dividends?: { period: string; cash: N; stock: N; ex: string | null }[];
  holders?: { d: string; big: N; big400: N; retail: N; n: N }[];
}
type N = number | null;

export interface Bar { t: string; o: number; h: number; l: number; c: number; v: number }
export type Period = "D" | "W" | "M";

/** 日 K 轉成畫圖用的 K 棒；adjusted=true 時乘上還原因子。沒成交的日子跳過。 */
export function dailyBars(s: StockFile, adjusted: boolean): Bar[] {
  const d = s.daily;
  const out: Bar[] = [];
  for (let i = 0; i < d.d.length; i++) {
    const o = d.o[i], h = d.h[i], l = d.l[i], c = d.c[i];
    if (o == null || h == null || l == null || c == null || c <= 0) continue;
    const k = adjusted ? (d.f[i] ?? 1) : 1;
    out.push({ t: d.d[i], o: o * k, h: h * k, l: l * k, c: c * k, v: d.v[i] ?? 0 });
  }
  return out;
}

export function weekKey(t: string) {
  const dt = new Date(`${t}T00:00:00Z`);
  const day = (dt.getUTCDay() + 6) % 7;            // 週一 = 0
  dt.setUTCDate(dt.getUTCDate() - day);
  return dt.toISOString().slice(0, 10);
}

/** 日 K 合併成週 K／月 K（時間標記用該期最後一個交易日）。 */
export function aggregate(bars: Bar[], p: Period): Bar[] {
  if (p === "D") return bars;
  const out: Bar[] = [];
  let key = "";
  for (const b of bars) {
    const k = p === "W" ? weekKey(b.t) : b.t.slice(0, 7);
    const last = out[out.length - 1];
    if (k !== key || !last) {
      out.push({ ...b });
      key = k;
    } else {
      last.h = Math.max(last.h, b.h);
      last.l = Math.min(last.l, b.l);
      last.c = b.c;
      last.v += b.v;
      last.t = b.t;
    }
  }
  return out;
}

export function periodKey(t: string, p: Period) {
  return p === "D" ? t : p === "W" ? weekKey(t) : t.slice(0, 7);
}

/** 法人買賣超（期間加總）與融資餘額（期間最後一天），對齊到 K 棒。 */
export function chipSeries(s: StockFile, bars: Bar[], p: Period) {
  const d = s.daily;
  const acc = new Map<string, { fi: number; it: number; dl: number; mb: number | null; has: boolean }>();
  for (let i = 0; i < d.d.length; i++) {
    const k = periodKey(d.d[i], p);
    const a = acc.get(k) ?? { fi: 0, it: 0, dl: 0, mb: null, has: false };
    if (d.fi[i] != null || d.it[i] != null) a.has = true;
    a.fi += d.fi[i] ?? 0; a.it += d.it[i] ?? 0; a.dl += d.dl[i] ?? 0;
    if (d.mb[i] != null) a.mb = d.mb[i];
    acc.set(k, a);
  }
  return bars.map((b) => {
    const a = acc.get(periodKey(b.t, p));
    return a && a.has ? { fi: a.fi, it: a.it, dl: a.dl, mb: a.mb } : { fi: null, it: null, dl: null, mb: a?.mb ?? null };
  });
}

export function sma(xs: number[], n: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= n) sum -= xs[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

function ema(xs: number[], span: number): number[] {
  const a = 2 / (span + 1);
  const out: number[] = [];
  xs.forEach((x, i) => out.push(i === 0 ? x : a * x + (1 - a) * out[i - 1]));
  return out;
}

/** KD(9,3,3) */
export function kd(bars: Bar[]) {
  const k: (number | null)[] = [], d: (number | null)[] = [];
  let pk = 50, pd = 50;
  bars.forEach((_, i) => {
    if (i < 8) { k.push(null); d.push(null); return; }
    let lo = Infinity, hi = -Infinity;
    for (let j = i - 8; j <= i; j++) { lo = Math.min(lo, bars[j].l); hi = Math.max(hi, bars[j].h); }
    const rsv = hi > lo ? ((bars[i].c - lo) / (hi - lo)) * 100 : 50;
    pk = (2 / 3) * pk + rsv / 3;
    pd = (2 / 3) * pd + pk / 3;
    k.push(pk); d.push(pd);
  });
  return { k, d };
}

/** MACD(12,26,9) */
export function macd(bars: Bar[]) {
  const c = bars.map((b) => b.c);
  const e12 = ema(c, 12), e26 = ema(c, 26);
  const dif = c.map((_, i) => e12[i] - e26[i]);
  const dea = ema(dif, 9);
  return { dif, dea, hist: dif.map((x, i) => x - dea[i]) };
}

// ---------------- 支撐與壓力 ----------------

export interface Zone { lo: number; hi: number; touches: number }

/**
 * 用最近 lookback 根 K 棒的轉折點（左右各 3 根的高低點）找價位聚集區：
 * 相距 1.5% 以內的轉折點合併成一個區間，觸碰次數越多越有參考性。
 */
export function supportResistance(bars: Bar[], lookback = 120) {
  const b = bars.slice(-lookback);
  const pts: number[] = [];
  for (let i = 3; i < b.length - 3; i++) {
    const win = b.slice(i - 3, i + 4);
    if (b[i].h === Math.max(...win.map((x) => x.h))) pts.push(b[i].h);
    if (b[i].l === Math.min(...win.map((x) => x.l))) pts.push(b[i].l);
  }
  pts.sort((x, y) => x - y);
  const zones: Zone[] = [];
  for (const p of pts) {
    const z = zones[zones.length - 1];
    if (z && p <= z.lo * 1.015) { z.hi = p; z.touches++; } else zones.push({ lo: p, hi: p, touches: 1 });
  }
  const price = b[b.length - 1]?.c ?? 0;
  const below = zones.filter((z) => z.hi < price * 0.995).sort((x, y) => y.hi - x.hi);
  const above = zones.filter((z) => z.lo > price * 1.005).sort((x, y) => x.lo - y.lo);
  const maxHigh = Math.max(...b.map((x) => x.h));
  return { price, supports: below.slice(0, 2), resistances: above.slice(0, 2), newHigh: price >= maxHigh * 0.995 };
}

// ---------------- 短中長線多空 ----------------

export interface Check { label: string; ok: boolean | null }
export interface Outlook { label: string; span: string; score: number; state: "偏多" | "中性" | "偏空" | "資料不足"; checks: Check[] }

function chk(label: string, cond: boolean | null): Check {
  return { label, ok: cond };
}

const gt = (a: unknown, b: unknown) => { const x = num(a), y = num(b); return x == null || y == null ? null : x > y; };
const pos = (a: unknown) => { const x = num(a); return x == null ? null : x > 0; };

/** 用快照裡的技術指標，逐項檢查後給出短／中／長線的狀態描述。 */
export function outlooks(r: Row): Outlook[] {
  const make = (label: string, span: string, checks: Check[]): Outlook => {
    const valid = checks.filter((c) => c.ok != null);
    const score = valid.reduce((s, c) => s + (c.ok ? 1 : -1), 0);
    const th = Math.max(1, Math.ceil(valid.length / 3));
    const state = valid.length < 3 ? "資料不足" : score >= th ? "偏多" : score <= -th ? "偏空" : "中性";
    return { label, span, score, checks, state };
  };
  return [
    make("短線", "約 1 週", [
      chk("股價在 5 日線之上", gt(r.adj_close, r.ma5)),
      chk("5 日線在 10 日線之上", gt(r.ma5, r.ma10)),
      chk("近 5 日上漲", pos(r.ret5)),
      chk("KD 的 K 值高於 D 值", gt(r.k, r.d)),
    ]),
    make("中線", "約 1 個月", [
      chk("股價在 20 日線（月線）之上", gt(r.adj_close, r.ma20)),
      chk("月線在 60 日線（季線）之上", gt(r.ma20, r.ma60)),
      chk("近 20 日上漲", pos(r.ret20)),
      chk("MACD 柱狀體為正", pos(r.macd_hist)),
    ]),
    make("長線", "半年以上", [
      chk("股價在 120 日線（半年線）之上", gt(r.adj_close, r.ma120)),
      chk("股價在 240 日線（年線）之上", gt(r.adj_close, r.ma240)),
      chk("季線在年線之上", gt(r.ma60, r.ma240)),
      chk("近 120 日上漲", pos(r.ret120)),
    ]),
  ];
}

// ---------------- 強勢焦點（全市場排名） ----------------

interface FocusDef { key: string; label: string; dir: 1 | -1; tone: "up" | "down" | "neutral"; amount?: boolean; min?: number }

const FOCUS: FocusDef[] = [
  { key: "foreign_net", label: "外資買超", dir: -1, tone: "up", amount: true },
  { key: "foreign_net", label: "外資賣超", dir: 1, tone: "down", amount: true },
  { key: "trust_net", label: "投信買超", dir: -1, tone: "up", amount: true },
  { key: "trust_net", label: "投信賣超", dir: 1, tone: "down", amount: true },
  { key: "dealer_net", label: "自營商買超", dir: -1, tone: "up", amount: true },
  { key: "total_net", label: "三大法人買超", dir: -1, tone: "up", amount: true },
  { key: "total_net", label: "三大法人賣超", dir: 1, tone: "down", amount: true },
  { key: "trust_buy_streak", label: "投信連買天數", dir: -1, tone: "up", min: 1 },
  { key: "value", label: "成交金額", dir: -1, tone: "neutral" },
  { key: "vol_ratio", label: "量能放大", dir: -1, tone: "neutral" },
  { key: "chg_pct", label: "當日漲幅", dir: -1, tone: "up", min: 0.01 },
  { key: "ret20", label: "近月漲幅", dir: -1, tone: "up", min: 0.01 },
  { key: "health_score", label: "財務健康", dir: -1, tone: "neutral" },
  { key: "f_score", label: "F-Score", dir: -1, tone: "neutral", min: 7 },
  { key: "rev_yoy", label: "營收年增率", dir: -1, tone: "neutral", min: 0.01 },
  { key: "roe", label: "ROE", dir: -1, tone: "neutral", min: 0.01 },
  { key: "dividend_yield", label: "殖利率", dir: -1, tone: "neutral", min: 0.01 },
];

export interface Focus { label: string; rank: number; tone: FocusDef["tone"] }

/** 這檔股票在全市場普通股中排名前 topN 的項目（法人買賣超以金額排名）。 */
export function focusTags(rows: Row[], code: string, topN = 20): Focus[] {
  const stocks = rows.filter((r) => r.sec_type === "stock");
  const me = stocks.find((r) => r.code === code);
  if (!me) return [];
  const val = (r: Row, f: FocusDef) => {
    const x = num(r[f.key]);
    if (x == null) return null;
    return f.amount ? x * (num(r.close) ?? 0) : x;
  };
  const out: Focus[] = [];
  for (const f of FOCUS) {
    const mine = val(me, f);
    if (mine == null) continue;
    if (f.amount && (f.dir === -1 ? mine <= 0 : mine >= 0)) continue;
    if (f.min != null && mine < f.min) continue;
    let rank = 1;
    for (const r of stocks) {
      const x = val(r, f);
      if (x != null && (f.dir === -1 ? x > mine : x < mine)) rank++;
      if (rank > topN) break;
    }
    if (rank <= topN) out.push({ label: f.label, rank, tone: f.tone });
  }
  return out.sort((a, b) => a.rank - b.rank);
}

// ---------------- 財務健康評級 ----------------

export function grade(score: number | null): string {
  if (score == null) return "—";
  if (score >= 85) return "A+";
  if (score >= 75) return "A";
  if (score >= 65) return "B+";
  if (score >= 55) return "B";
  if (score >= 45) return "C+";
  if (score >= 35) return "C";
  return "D";
}

/** 同產業排名（依健康分數，1 = 最好）。 */
export function industryRank(rows: Row[], code: string): { rank: number; total: number } | null {
  const me = rows.find((r) => r.code === code);
  const ind = me?.industry;
  const score = num(me?.health_score);
  if (!ind || score == null) return null;
  const peers = rows.filter((r) => r.industry === ind && num(r.health_score) != null);
  return { rank: 1 + peers.filter((r) => (num(r.health_score) as number) > score).length, total: peers.length };
}
