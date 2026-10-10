/**
 * 交易日判斷：週末與證交所休市日（pipeline 放在快照 meta.holidays）不算交易日。
 * 「應該要有」的最新資料日＝台灣時間 18:00 以後算當天，之前算前一個交易日。
 */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function expectedTradingDay(holidays: string[] = [], now = new Date()): string {
  const tw = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Taipei" }));
  const d = new Date(tw);
  if (tw.getHours() < 18) d.setDate(d.getDate() - 1);
  const off = new Set(holidays);
  for (let i = 0; i < 30 && (d.getDay() === 0 || d.getDay() === 6 || off.has(ymd(d))); i++) d.setDate(d.getDate() - 1);
  return ymd(d);
}

/** 資料日比「應該要有」的交易日舊才算落後 */
export const isLate = (asof: string, holidays?: string[]) => asof < expectedTradingDay(holidays);
