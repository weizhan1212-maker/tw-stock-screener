/** K 線圖技術指標（全部在瀏覽器計算）。輸入都是依時間排序的 K 棒。 */
import type { Bar } from "./stock";

type S = (number | null)[];

export function smaN(xs: number[], n: number): S {
  const out: S = [];
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    sum += xs[i];
    if (i >= n) sum -= xs[i - n];
    out.push(i >= n - 1 ? sum / n : null);
  }
  return out;
}

export function emaN(xs: number[], span: number): number[] {
  const a = 2 / (span + 1);
  const out: number[] = [];
  xs.forEach((x, i) => out.push(i === 0 ? x : a * x + (1 - a) * out[i - 1]));
  return out;
}

/** Wilder 平滑（RSI、DMI 用） */
function wilder(xs: number[], n: number): S {
  const out: S = [];
  let prev: number | null = null;
  for (let i = 0; i < xs.length; i++) {
    if (i < n - 1) { out.push(null); continue; }
    if (prev == null) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += xs[j];
      prev = s / n;
    } else {
      prev = (prev * (n - 1) + xs[i]) / n;
    }
    out.push(prev);
  }
  return out;
}

/** 布林通道(n, k)：中線、上軌、下軌 */
export function bollinger(bars: Bar[], n = 20, k = 2) {
  const c = bars.map((b) => b.c);
  const mid = smaN(c, n);
  const up: S = [], lo: S = [];
  c.forEach((_, i) => {
    const m = mid[i];
    if (m == null) { up.push(null); lo.push(null); return; }
    let v = 0;
    for (let j = i - n + 1; j <= i; j++) v += (c[j] - m) ** 2;
    const sd = Math.sqrt(v / n);
    up.push(m + k * sd); lo.push(m - k * sd);
  });
  return { mid, up, lo };
}

/** RSI(n) */
export function rsi(bars: Bar[], n: number): S {
  const up: number[] = [0], dn: number[] = [0];
  for (let i = 1; i < bars.length; i++) {
    const d = bars[i].c - bars[i - 1].c;
    up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0));
  }
  const u = wilder(up.slice(1), n), d = wilder(dn.slice(1), n);
  return [null, ...u.map((x, i) => (x == null || d[i] == null ? null : d[i] === 0 ? 100 : 100 - 100 / (1 + x / (d[i] as number))))];
}

/** 乖離率：(收盤 − n 日均線) ÷ n 日均線 × 100 */
export function bias(bars: Bar[], n: number): S {
  const c = bars.map((b) => b.c);
  return smaN(c, n).map((m, i) => (m == null ? null : ((c[i] - m) / m) * 100));
}

/** DMI(n)：+DI、−DI、ADX */
export function dmi(bars: Bar[], n = 14) {
  const tr: number[] = [], pdm: number[] = [], mdm: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    tr.push(Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c)));
    const upMove = b.h - p.h, downMove = p.l - b.l;
    pdm.push(upMove > downMove && upMove > 0 ? upMove : 0);
    mdm.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }
  const atr = wilder(tr, n), sp = wilder(pdm, n), sm = wilder(mdm, n);
  const pdi: S = [null], mdi: S = [null], dx: number[] = [];
  const dxIdx: number[] = [];
  atr.forEach((a, i) => {
    if (a == null || a === 0 || sp[i] == null || sm[i] == null) { pdi.push(null); mdi.push(null); return; }
    const p = ((sp[i] as number) / a) * 100, m = ((sm[i] as number) / a) * 100;
    pdi.push(p); mdi.push(m);
    dx.push(p + m === 0 ? 0 : (Math.abs(p - m) / (p + m)) * 100);
    dxIdx.push(i + 1);
  });
  const adxRaw = wilder(dx, n);
  const adx: S = bars.map(() => null);
  adxRaw.forEach((v, j) => { adx[dxIdx[j]] = v; });
  return { pdi, mdi, adx };
}

/** 威廉指標 %R(n)：0 ~ −100 */
export function williams(bars: Bar[], n = 14): S {
  return bars.map((b, i) => {
    if (i < n - 1) return null;
    let hi = -Infinity, lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) { hi = Math.max(hi, bars[j].h); lo = Math.min(lo, bars[j].l); }
    return hi === lo ? -50 : ((hi - b.c) / (hi - lo)) * -100;
  });
}

/** OBV 能量潮（張） */
export function obv(bars: Bar[]): number[] {
  let v = 0;
  return bars.map((b, i) => {
    if (i > 0) v += b.c > bars[i - 1].c ? b.v : b.c < bars[i - 1].c ? -b.v : 0;
    return v;
  });
}
