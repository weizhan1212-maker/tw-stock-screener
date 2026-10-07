/**
 * 富果行情 API（盤中即時報價）。金鑰放在環境變數 FUGLE_API_KEY；沒設定時整個功能隱藏。
 * 免費方案每分鐘 60 次：同一檔 8 秒內共用快取，並在本機計數，超過 55 次就先回舊資料。
 */
const BASE = process.env.FUGLE_BASE ?? "https://api.fugle.tw/marketdata/v1.0/stock";
const TTL = 8_000;
const PER_MIN = 55;

export interface Level { price: number; size: number }
export interface LiveQuote {
  code: string; name: string; date: string; time: string | null;
  price: number | null; ref: number | null; change: number | null; pct: number | null;
  open: number | null; high: number | null; low: number | null; avg: number | null;
  volLots: number | null; value: number | null;
  bids: Level[]; asks: Level[];
  isClose: boolean; isTrial: boolean; limitUp: boolean; limitDown: boolean;
}

export const fugleEnabled = () => !!process.env.FUGLE_API_KEY;

const cache = new Map<string, { t: number; q: LiveQuote }>();
const hits: number[] = [];

function budgetOk() {
  const now = Date.now();
  while (hits.length && now - hits[0] > 60_000) hits.shift();
  if (hits.length >= PER_MIN) return false;
  hits.push(now);
  return true;
}

const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);

/** 富果時間戳是微秒（文件寫奈秒，實際範例是 16 位數）；兩種都處理。 */
function toIso(t: unknown): string | null {
  const v = num(t);
  if (!v) return null;
  const ms = v > 1e17 ? v / 1e6 : v > 1e14 ? v / 1e3 : v;
  return new Date(ms).toISOString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function normalize(code: string, j: any): LiveQuote {
  const price = num(j.lastPrice) ?? num(j.closePrice);
  const ref = num(j.referencePrice) ?? num(j.previousClose);
  const vol = num(j.total?.tradeVolume);
  const value = num(j.total?.tradeValue);
  // 成交量單位：一般是張；若「金額 ÷ 均價」接近量的 1 倍代表是股，換算成張
  const avg = num(j.avgPrice) ?? price;
  const inShares = vol != null && !!value && !!avg && Math.abs(value / avg / vol - 1) < 0.2;
  const k = inShares ? 1000 : 1;
  const volLots = vol == null ? null : vol / k;
  const lv = (x: unknown): Level[] => (Array.isArray(x) ? x.slice(0, 5).map((l) => ({ price: Number(l.price), size: Number(l.size) / k })) : []);
  return {
    code, name: String(j.name ?? ""), date: String(j.date ?? ""),
    time: toIso(j.lastUpdated ?? j.lastTrade?.time ?? j.total?.time),
    price, ref,
    change: num(j.change) ?? (price != null && ref != null ? price - ref : null),
    pct: num(j.changePercent) ?? (price != null && ref ? (price / ref - 1) * 100 : null),
    open: num(j.openPrice), high: num(j.highPrice), low: num(j.lowPrice), avg: num(j.avgPrice),
    volLots, value,
    bids: lv(j.bids), asks: lv(j.asks),
    isClose: !!j.isClose, isTrial: !!j.isTrial,
    limitUp: !!j.isLimitUpPrice, limitDown: !!j.isLimitDownPrice,
  };
}

export async function quote(code: string): Promise<LiveQuote | null> {
  const c = cache.get(code);
  if (c && Date.now() - c.t < TTL) return c.q;
  if (!budgetOk()) return c?.q ?? null;
  const r = await fetch(`${BASE}/intraday/quote/${encodeURIComponent(code)}`, {
    headers: { "X-API-KEY": process.env.FUGLE_API_KEY ?? "" }, cache: "no-store",
  });
  if (r.status === 429) return c?.q ?? null;
  if (!r.ok) throw new Error(`富果 HTTP ${r.status}`);
  const q = normalize(code, await r.json());
  cache.set(code, { t: Date.now(), q });
  return q;
}
