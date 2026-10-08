/** 快照資料與篩選邏輯（全部在瀏覽器裡算）。 */
import { FIELD_MAP, type Format, UNIT } from "./fields";

export type Row = Record<string, string | number | null>;

export interface Snapshot {
  meta: { asof: string; generated_at: string; count: number; fin_complete: boolean;
    /** 融資融券、外資持股的資料日（傍晚場會比 asof 早一天）；complete＝當天籌碼已到齊 */
    margin_asof?: string | null; qfii_asof?: string | null; complete?: boolean;
    taiex?: number; taiex_ma200?: number; market_bull?: boolean };
  rows: Row[];
}

export interface RawSnapshot {
  meta: Snapshot["meta"];
  columns: string[];
  rows: (string | number | null)[][];
}

export const num = (v: unknown): number | null => (typeof v === "number" && !Number.isNaN(v) ? v : null);

/** 欄位陣列轉物件，並補上衍生欄位（站上均線等）。 */
export function decode(raw: RawSnapshot): Snapshot {
  const cols = raw.columns;
  const rows = raw.rows.map((r) => {
    const o: Row = {};
    cols.forEach((c, i) => (o[c] = r[i]));
    const ac = o.adj_close as number | null;
    for (const w of [20, 60, 240]) {
      const ma = o[`ma${w}`] as number | null;
      o[`above_ma${w}`] = ac == null || ma == null ? null : ac > ma ? 1 : 0;
    }
    // 衍生估值指標
    const pe = num(o.pe), pb = num(o.pb), g = num(o.eps_cagr3), y = num(o.dividend_yield);
    o.pe_pb = pe != null && pb != null && pe > 0 ? pe * pb : null;
    o.peg = pe != null && g != null && pe > 0 && g > 0 ? pe / g : null;
    o.neff_ratio = pe != null && g != null && pe > 0 ? (g + (y ?? 0)) / pe : null;
    return o;
  });
  return { meta: raw.meta, rows };
}

export type Op = "ge" | "le" | "between" | "is";

export interface Condition {
  id: string;
  field: string;
  op: Op;
  a?: number;
  b?: number;
}

export type Universe = "all" | "stock" | "etf";
export type Market = "all" | "TWSE" | "TPEX";

export function passes(row: Row, c: Condition): boolean {
  const v = row[c.field];
  if (v == null || typeof v !== "number" || Number.isNaN(v)) return false;   // 沒資料 = 不符合
  const f = FIELD_MAP[c.field];
  const x = f && (f.format === "yi") ? v / 1e8 : v;                            // 億元欄位：條件以億為單位
  switch (c.op) {
    case "is":
      return x === 1;
    case "ge":
      return c.a == null || x >= c.a;
    case "le":
      return c.a == null || x <= c.a;
    case "between":
      return (c.a == null || x >= c.a) && (c.b == null || x <= c.b);
  }
}

export function inUniverse(row: Row, u: Universe, m: Market): boolean {
  if (u !== "all" && row.sec_type !== u) return false;
  if (m !== "all" && row.market !== m) return false;
  return true;
}

/** 篩選漏斗：每加一個條件後剩幾檔，以及每個條件單獨符合幾檔。 */
export function funnel(rows: Row[], conds: Condition[]) {
  let cur = rows;
  const steps = conds.map((c) => {
    const alone = rows.reduce((n, r) => n + (passes(r, c) ? 1 : 0), 0);
    cur = cur.filter((r) => passes(r, c));
    return { id: c.id, remaining: cur.length, alone };
  });
  return { result: cur, steps };
}

// ---------- 顯示格式 ----------

const nf = (d: number) => new Intl.NumberFormat("zh-TW", { minimumFractionDigits: d, maximumFractionDigits: d });
const N0 = nf(0), N1 = nf(1), N2 = nf(2);

/** 會有正負號的欄位（漲跌、成長率、買賣超等）才顯示「+」 */
export function isSigned(key: string): boolean {
  return /^(chg_pct|ret\d+|dist_|eps_q_yoy|rev_yoy|rev_mom|rev_yoy_chg|rs\d+|inst_amt\d+|.*_net\d*$|margin_chg5|macd_hist|big_pct_chg|(foreign|trust|dealer|total)_value$)/.test(key);
}

export function fmt(v: unknown, format: Format, signed = false): string {
  if (v == null || typeof v !== "number" || Number.isNaN(v)) return "—";
  switch (format) {
    case "bool":
      return v === 1 ? "是" : "否";
    case "price":
      return N2.format(v);                              // 同一欄一律兩位小數，右對齊時小數點對齊
    case "pct":
      if (Math.abs(v) >= 1000) return v > 0 ? "> 999" : "< -999";   // 營收極小的公司比率會爆掉，截斷顯示
      return `${signed && v > 0 ? "+" : ""}${N2.format(v)}`;
    case "lots":
      return N0.format(v);
    case "yi":
      return N2.format(v / 1e8);
    case "yiRaw":
      return v >= 100 ? N0.format(v) : N1.format(v);
    case "days":
    case "years":
    case "count":
      return N0.format(v);
    default:
      return N2.format(v);
  }
}

export function fmtUnit(v: unknown, format: Format, signed = false): string {
  const s = fmt(v, format, signed);
  const u = UNIT[format];
  return s === "—" || !u || format === "bool" ? s : `${s} ${u}`;
}

/** 漲跌顏色：台股紅漲綠跌 */
export function tone(v: unknown): "up" | "down" | "flat" {
  if (typeof v !== "number" || v === 0 || Number.isNaN(v)) return "flat";
  return v > 0 ? "up" : "down";
}

// ---------- 網址狀態 ----------

export function encodeConds(conds: Condition[]): string {
  return conds
    .map((c) => [c.field, c.op, c.a ?? "", c.b ?? ""].join(":").replace(/:+$/, ""))
    .join(",");
}

export function decodeConds(s: string | null): Condition[] {
  if (!s) return [];
  return s
    .split(",")
    .map((part, i): Condition | null => {
      const [field, op, a, b] = part.split(":");
      if (!FIELD_MAP[field] || !["ge", "le", "between", "is"].includes(op)) return null;
      const num = (x?: string) => (x === undefined || x === "" ? undefined : Number(x));
      return { id: `c${i}-${field}`, field, op: op as Op, a: num(a), b: num(b) };
    })
    .filter((x): x is Condition => x !== null);
}
