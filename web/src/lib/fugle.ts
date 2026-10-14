/**
 * 富果行情 API（盤中即時報價）。金鑰放在環境變數 FUGLE_API_KEY；沒設定時整個功能隱藏。
 * 免費方案每分鐘 60 次：同一檔 8 秒內共用快取，並在本機計數，超過 55 次就先回舊資料。
 */
const BASE = process.env.FUGLE_BASE ?? "https://api.fugle.tw/marketdata/v1.0/stock";
const FUT_BASE = process.env.FUGLE_FUT_BASE ?? "https://api.fugle.tw/marketdata/v1.0/futopt";

/** 台指期近月合約代號（TXF＋月份字母 A–L＋年份尾數）。結算日＝每月第三個星期三，13:30 後換下個月。 */
export function txfSymbol(now = new Date()) {
  const tw = new Date(now.getTime() + 8 * 3600_000);                 // 台灣時間（用 UTC 欄位讀）
  let y = tw.getUTCFullYear(), m = tw.getUTCMonth();
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  const settle = 1 + ((3 - first + 7) % 7) + 14;                      // 第三個星期三
  const d = tw.getUTCDate(), mins = tw.getUTCHours() * 60 + tw.getUTCMinutes();
  if (d > settle || (d === settle && mins >= 13 * 60 + 30)) { m += 1; if (m > 11) { m = 0; y += 1; } }
  return `TXF${"ABCDEFGHIJKL"[m]}${y % 10}`;
}
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
  /** 額度用完或被富果限流時回傳的是快取：stale=true，fetchedAt＝那份資料抓到的時間 */
  stale?: boolean; fetchedAt?: string;
}

/** 一鍵下架：Vercel 環境變數 LIVE_QUOTES=off（或刪掉 FUGLE_API_KEY）就整個隱藏 */
export const fugleEnabled = () => !!process.env.FUGLE_API_KEY && process.env.LIVE_QUOTES !== "off";

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
  // 台指期：TXF＝一般盤、TXF_AH＝盤後，換成近月合約到富果期貨 API 查
  const fut = code === "TXF" || code === "TXF_AH";
  const url = fut
    ? `${FUT_BASE}/intraday/quote/${txfSymbol()}${code === "TXF_AH" ? "?session=afterhours" : ""}`
    : `${BASE}/intraday/quote/${encodeURIComponent(code)}`;
  const c = cache.get(code);
  // 指數、台指期是首頁大家共用的，快取放長一點（20 秒），省每分鐘 60 次的共用額度
  const ttl = fut || code.startsWith("IX") ? 20_000 : TTL;
  if (c && Date.now() - c.t < ttl) return c.q;
  const old = () => (c ? { ...c.q, stale: true } : null);
  if (!budgetOk()) return old();
  const r = await fetch(url, {
    headers: { "X-API-KEY": process.env.FUGLE_API_KEY ?? "" }, cache: "no-store",
  });
  if (r.status === 429) return old();
  if (!r.ok) throw new Error(`富果 HTTP ${r.status}${fut ? `（${txfSymbol()}）：${(await r.text().catch(() => "")).slice(0, 80)}` : ""}`);
  const q = { ...normalize(code, await r.json()), fetchedAt: new Date().toISOString() };
  cache.set(code, { t: Date.now(), q });
  return q;
}
