/** 自訂篩選的品質檢查：提醒條件太嚴／太寬、重複、資料缺漏、產業集中、流動性。只描述，不判斷好壞。 */
import { FIELD_MAP } from "./fields";
import { type Condition, funnel, num, type Row } from "./screener";

export interface Check { level: "warn" | "info"; text: string }

const GROUP_OF: [RegExp, string][] = [
  [/^(pe|pb|pe_pb|peg|psr|pcf|earnings_yield|neff_ratio|dividend_yield)$/, "估值"],
  [/^(roe|roa|roe_min5y|gross_margin|op_margin|net_margin|gm_stability|roc)$/, "獲利能力"],
  [/^(rev_yoy|rev_yoy_min3|rev_yoy_chg|rev_mom|rev_ttm_yoy|eps_q_yoy|eps_cagr3|eps_growth_3v3|eps_up3y)$/, "成長"],
  [/^(ret\d+|rs\d+|dist_high\d+|new_high\d+|bull_align|above_ma\d+|dist_ma240|industry_rank)$/, "價格動能"],
  [/^(foreign_|trust_|dealer_|total_|inst_amt)/, "法人籌碼"],
];
const groupOf = (k: string) => GROUP_OF.find(([re]) => re.test(k))?.[1];
const label = (k: string) => FIELD_MAP[k]?.label ?? k;

export function qualityCheck(pool: Row[], conds: Condition[], result: Row[]): Check[] {
  const out: Check[] = [];
  if (!conds.length || !pool.length) return out;
  const n = result.length;
  if (n > 0 && n < 5) out.push({ level: "warn", text: `只剩 ${n} 檔：條件可能太嚴，結果容易被單一公司左右。` });
  if (n > 300) out.push({ level: "info", text: `還有 ${n} 檔：條件偏寬，可以再加條件，或用排序只看前段。` });

  // 拿掉某個條件結果不變 → 這個條件被其他條件涵蓋
  if (conds.length > 1) {
    for (const c of conds) {
      const without = funnel(pool, conds.filter((x) => x.id !== c.id)).result.length;
      if (without === n) out.push({ level: "info", text: `拿掉「${label(c.field)}」結果不變，它可能跟其他條件重複。` });
    }
  }
  // 同一類條件疊太多
  const groups = new Map<string, string[]>();
  for (const c of conds) { const g = groupOf(c.field); if (g) groups.set(g, [...(groups.get(g) ?? []), label(c.field)]); }
  for (const [g, ls] of groups) if (ls.length >= 3) out.push({ level: "info", text: `${g}類條件有 ${ls.length} 個（${ls.join("、")}），彼此高度相關，容易過度篩選。` });

  // 資料缺漏
  for (const c of conds) {
    const miss = pool.filter((r) => num(r[c.field]) == null).length;
    if (miss / pool.length > 0.1) out.push({ level: "info", text: `「${label(c.field)}」有 ${miss} 檔沒有資料（例如 ETF、新上市或金融股），這些會直接被排除。` });
  }
  if (n >= 5) {
    // 產業集中
    const cnt = new Map<string, number>();
    for (const r of result) if (r.ind) cnt.set(r.ind as string, (cnt.get(r.ind as string) ?? 0) + 1);
    const top = [...cnt].sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] / n >= 0.5) out.push({ level: "warn", text: `${Math.round((top[1] / n) * 100)}% 集中在「${top[0]}」，產業風險集中。` });
    // 流動性
    const thin = result.filter((r) => { const v = num(r.avg_value20); return v != null && v < 0.1; }).length;
    if (thin / n >= 0.3) out.push({ level: "warn", text: `${thin} 檔近 20 日平均成交值不到 1,000 萬元，買賣可能不容易成交。` });
    // 市值集中
    const caps = result.map((r) => num(r.market_cap) ?? 0).sort((a, b) => b - a);
    const sum = caps.reduce((a, b) => a + b, 0);
    if (sum > 0 && caps[0] / sum >= 0.5) out.push({ level: "info", text: `最大一檔占結果總市值 ${Math.round((caps[0] / sum) * 100)}%，按市值加權會幾乎等於買這一檔。` });
    const tw = result.filter((r) => r.market === "TWSE").length;
    out.push({ level: "info", text: `上市 ${tw} 檔、上櫃 ${n - tw} 檔。` });
  }
  return out;
}
