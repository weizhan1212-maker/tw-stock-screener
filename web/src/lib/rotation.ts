/**
 * 資金輪動：把股票分成題材或官方產業，計算每一組今天吸引了多少資金、漲跌與法人動向。
 * - 成交占比：該組今天成交金額 ÷ 全市場普通股成交金額；跟自己 20 日平均占比比，就知道資金是流入還是退潮。
 * - 熱度：今日占比 ÷ 20 日平均占比（> 1 代表今天比平常更多錢在這裡）。
 * - 漲跌用「中位數」：不讓單一權值股（例如台積電）代表整組。
 * 只描述現況，不預測。前端與 AI 摘要共用同一份計算。
 */
import { num, type Row } from "@/lib/screener";
import { THEMES } from "@/lib/themes";

export interface GroupStat {
  name: string; n: number;
  share: number; share20: number; heat: number;     // 成交占比（%）、20 日平均占比（%）、熱度（倍）
  chg: number | null; ret5: number | null; ret20: number | null;   // 漲跌幅中位數（%）
  upRatio: number;                                   // 上漲家數比例（%）
  inst5: number | null;                              // 法人 5 日買賣超金額合計（億，估算）
  leaders: { code: string; name: string; chg: number }[];   // 今天漲最多的 3 檔
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function stat(name: string, rows: Row[], tot: number, tot20: number): GroupStat | null {
  const live = rows.filter((r) => (num(r.close) ?? 0) > 0);
  if (live.length < 3) return null;
  const val = live.reduce((a, r) => a + (num(r.value) ?? 0), 0);
  const val20 = live.reduce((a, r) => a + (num(r.avg_value20) ?? 0), 0);
  const share = tot > 0 ? (val / tot) * 100 : 0;
  const share20 = tot20 > 0 ? (val20 / tot20) * 100 : 0;
  const pick = (k: string) => median(live.map((r) => num(r[k])).filter((v): v is number => v != null));
  const up = live.filter((r) => (num(r.chg_pct) ?? 0) > 0).length;
  const down = live.filter((r) => (num(r.chg_pct) ?? 0) < 0).length;
  const insts = live.map((r) => num(r.inst_amt5)).filter((v): v is number => v != null);
  return {
    name, n: live.length, share, share20, heat: share20 > 0 ? share / share20 : 0,
    chg: pick("chg_pct"), ret5: pick("ret5"), ret20: pick("ret20"),
    upRatio: up + down ? (up / (up + down)) * 100 : 50,
    inst5: insts.length ? insts.reduce((a, b) => a + b, 0) : null,
    leaders: live.filter((r) => num(r.chg_pct) != null).sort((a, b) => (num(b.chg_pct) as number) - (num(a.chg_pct) as number)).slice(0, 3)
      .map((r) => ({ code: String(r.code), name: String(r.name), chg: num(r.chg_pct) as number })),
  };
}

export interface Rotation { themes: GroupStat[]; industries: GroupStat[] }

/** 算出所有題材與產業的輪動數據（依熱度由高到低排序）。 */
export function computeRotation(rows: Row[]): Rotation {
  const stocks = rows.filter((r) => r.sec_type === "stock");
  const tot = stocks.reduce((a, r) => a + (num(r.value) ?? 0), 0);
  // avg_value20 單位是「億」、value 是「元」：各自跟自己的總和比，單位不影響占比
  const tot20 = stocks.reduce((a, r) => a + (num(r.avg_value20) ?? 0), 0);
  const byCode = new Map(stocks.map((r) => [String(r.code), r]));
  const themes = THEMES.map((t) => stat(t.name, t.codes.map((c) => byCode.get(c)).filter((r): r is Row => !!r), tot, tot20)).filter((x): x is GroupStat => !!x);
  const inds = new Map<string, Row[]>();
  for (const r of stocks) {
    const k = r.ind ? String(r.ind) : "";
    if (!k) continue;
    if (!inds.has(k)) inds.set(k, []);
    inds.get(k)!.push(r);
  }
  // 產業只看有一定規模的（20 日平均占比 0.3% 以上），太小的熱度數字會亂跳
  const industries = [...inds].map(([k, rs]) => stat(k, rs, tot, tot20)).filter((x): x is GroupStat => !!x && x.share20 >= 0.3);
  const byHeat = (a: GroupStat, b: GroupStat) => b.heat - a.heat;
  return { themes: themes.sort(byHeat), industries: industries.sort(byHeat) };
}

/** 資金流入：熱度高且今天中位數上漲；退潮：熱度低或明顯下跌。 */
export function splitFlow(list: GroupStat[], n = 5) {
  const inflow = list.filter((g) => g.heat >= 1.1 && (g.chg ?? 0) > 0).slice(0, n);
  const outflow = [...list].reverse().filter((g) => g.heat <= 0.9 || (g.chg ?? 0) < -1).slice(0, n);
  return { inflow, outflow };
}
