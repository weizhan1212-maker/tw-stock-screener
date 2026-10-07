/** 產業統計：從快照（每檔一列）在瀏覽器即時算出，只算普通股（排除 ETF）。 */
import { num, type Row } from "./screener";

export type Period = "chg_pct" | "ret5" | "ret20" | "ret60";
export const PERIODS: [Period, string][] = [["chg_pct", "今日"], ["ret5", "5 日"], ["ret20", "20 日"], ["ret60", "60 日"]];
/** 顏色滿格時的漲跌幅 */
export const SCALE: Record<Period, number> = { chg_pct: 3, ret5: 6, ret20: 12, ret60: 20 };

export interface IndustryStat {
  name: string;
  n: number;
  cap: number;              // 總市值（億）
  ret: Record<Period, number | null>; // 市值加權漲跌幅
  rs20: number | null;      // 市值加權 20 日相對強度
  rs60: number | null;
  upRatio: number | null;   // 今日上漲家數比例
  above60: number | null;   // 站上季線比例
  inst5: number;            // 法人 5 日買賣超（億，估算）
  inst20: number;
  pe: { p25: number | null; med: number | null; p75: number | null };
  pb: number | null;
  revUp: number | null;     // 月營收年增 > 0 的比例
  revMed: number | null;    // 月營收年增率中位數
}

/** ind＝主要產業（管線依官方產業別代碼算出，一檔只屬一個產業） */
export const isIndustryStock = (r: Row) => r.sec_type === "stock" && r.stale !== 1 && typeof r.ind === "string" && r.ind !== "";

function quant(xs: number[], q: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}

function weighted(rows: Row[], k: string): number | null {
  let w = 0, s = 0;
  for (const r of rows) {
    const x = num(r[k]), c = num(r.market_cap);
    if (x == null || c == null || c <= 0) continue;
    w += c; s += x * c;
  }
  return w ? s / w : null;
}

function ratio(rows: Row[], f: (r: Row) => boolean | null): number | null {
  let n = 0, y = 0;
  for (const r of rows) { const v = f(r); if (v == null) continue; n++; if (v) y++; }
  return n ? (y / n) * 100 : null;
}

export function statOf(name: string, rows: Row[]): IndustryStat {
  const vals = (k: string, pos = false) => rows.map((r) => num(r[k])).filter((x): x is number => x != null && (!pos || x > 0));
  const pe = vals("pe", true);
  const sum = (k: string) => rows.reduce((a, r) => a + (num(r[k]) ?? 0), 0);
  return {
    name, n: rows.length, cap: sum("market_cap"),
    ret: { chg_pct: weighted(rows, "chg_pct"), ret5: weighted(rows, "ret5"), ret20: weighted(rows, "ret20"), ret60: weighted(rows, "ret60") },
    rs20: weighted(rows, "rs20"), rs60: weighted(rows, "rs60"),
    upRatio: ratio(rows, (r) => { const c = num(r.chg_pct); return c == null ? null : c > 0; }),
    above60: ratio(rows, (r) => (r.above_ma60 == null ? null : r.above_ma60 === 1)),
    inst5: sum("inst_amt5"), inst20: sum("inst_amt20"),
    pe: { p25: quant(pe, 0.25), med: quant(pe, 0.5), p75: quant(pe, 0.75) },
    pb: quant(vals("pb", true), 0.5),
    revUp: ratio(rows, (r) => { const c = num(r.rev_yoy); return c == null ? null : c > 0; }),
    revMed: quant(vals("rev_yoy"), 0.5),
  };
}

export function groupIndustries(rows: Row[]): Map<string, Row[]> {
  const m = new Map<string, Row[]>();
  for (const r of rows) {
    if (!isIndustryStock(r)) continue;
    const k = r.ind as string;
    m.set(k, [...(m.get(k) ?? []), r]);
  }
  return m;
}

export function industryStats(rows: Row[]): IndustryStat[] {
  return [...groupIndustries(rows)].map(([k, rs]) => statOf(k, rs)).sort((a, b) => b.cap - a.cap);
}

/** 把產業狀態翻成白話（固定規則，不預測） */
export function industryNotes(s: IndustryStat): string[] {
  const out: string[] = [];
  if (s.rs20 != null && s.rs60 != null) {
    if (s.rs20 > 3 && s.rs60 > 5) out.push("近一個月與近一季都強於大盤，資金持續偏好這個產業。");
    else if (s.rs20 > 3 && s.rs60 <= 0) out.push("近一個月轉強，但近一季仍落後大盤，屬於剛開始反彈。");
    else if (s.rs20 < -3 && s.rs60 > 5) out.push("近一季強於大盤，但近一個月轉弱，可能在漲多後休息。");
    else if (s.rs20 < -3 && s.rs60 < -5) out.push("近一個月與近一季都落後大盤，目前不是資金焦點。");
  }
  if (s.inst5 > 0 && (s.ret.ret5 ?? 0) <= 0) out.push("法人近 5 日偏買，但股價還沒漲。");
  if (s.inst5 < 0 && (s.ret.ret5 ?? 0) > 0) out.push("股價近 5 日上漲，但法人偏賣，上漲可能靠散戶或內資。");
  if (s.revUp != null && s.n >= 5) {
    if (s.revUp >= 70) out.push(`${Math.round(s.revUp)}% 的公司月營收比去年成長，產業景氣普遍向上。`);
    else if (s.revUp <= 30) out.push(`只有 ${Math.round(s.revUp)}% 的公司月營收比去年成長，產業景氣偏弱。`);
  }
  return out;
}
