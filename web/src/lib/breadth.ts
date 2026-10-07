/** 市場廣度：從盤後快照算出「多少股票在漲、在強」，並用固定規則翻成白話（描述現況，不預測）。 */
import type { Row } from "@/lib/screener";

export type Scope = "all" | "TWSE" | "TPEX";

export interface Breadth {
  n: number; up: number; down: number; flat: number; upRatio: number;
  above20: number; above60: number; above240: number;   // 站上均線比例（%）
  newHigh20: number; newHigh52: number; newLow52: number;
  limitUp: number; limitDown: number;
}

const v = (r: Row, k: string) => (typeof r[k] === "number" ? (r[k] as number) : null);

export function computeBreadth(rows: Row[], scope: Scope): Breadth {
  const s = rows.filter((r) => r.sec_type === "stock" && (scope === "all" || r.market === scope) && (v(r, "close") ?? 0) > 0);
  const cnt = (f: (r: Row) => boolean) => s.reduce((a, r) => a + (f(r) ? 1 : 0), 0);
  const withK = (k: string) => s.filter((r) => v(r, k) != null);
  const pct = (k: string) => {
    const a = withK(k);
    return a.length ? (a.filter((r) => v(r, k) === 1).length / a.length) * 100 : 0;
  };
  const up = cnt((r) => (v(r, "chg_pct") ?? 0) > 0);
  const down = cnt((r) => (v(r, "chg_pct") ?? 0) < 0);
  return {
    n: s.length, up, down, flat: s.length - up - down, upRatio: up + down ? (up / (up + down)) * 100 : 50,
    above20: pct("above_ma20"), above60: pct("above_ma60"), above240: pct("above_ma240"),
    newHigh20: cnt((r) => v(r, "new_high20") === 1),
    newHigh52: cnt((r) => (v(r, "dist_high52") ?? -1) >= 0),
    newLow52: cnt((r) => (v(r, "dist_low52") ?? 1) <= 0),
    limitUp: cnt((r) => (v(r, "chg_pct") ?? 0) >= 9.5),
    limitDown: cnt((r) => (v(r, "chg_pct") ?? 0) <= -9.5),
  };
}

export interface Note { tone: "warn" | "good" | "info"; text: string }

/** 規則式說明：每一條都附上它依據的數字。 */
export function breadthNotes(b: Breadth, idxPct: number | null, valueRatio: number | null | undefined): Note[] {
  const out: Note[] = [];
  const r0 = (x: number) => x.toFixed(0);
  if (idxPct != null) {
    if (idxPct >= 1 && b.upRatio < 45)
      out.push({ tone: "warn", text: `指數強、廣度弱：大盤 +${idxPct.toFixed(2)}%，但只有 ${r0(b.upRatio)}% 的個股上漲，漲勢集中在大型權值股，追價風險較高。` });
    else if (idxPct <= -1 && b.upRatio > 55)
      out.push({ tone: "info", text: `指數弱、廣度強：大盤 ${idxPct.toFixed(2)}%，但有 ${r0(b.upRatio)}% 的個股上漲，跌勢集中在大型權值股。` });
    else if (idxPct >= 1 && b.upRatio >= 65)
      out.push({ tone: "good", text: `漲勢普遍：大盤 +${idxPct.toFixed(2)}%，${r0(b.upRatio)}% 的個股上漲，不是只有少數權值股在撐。` });
    else if (idxPct <= -1 && b.upRatio <= 35)
      out.push({ tone: "warn", text: `跌勢普遍：大盤 ${idxPct.toFixed(2)}%，只有 ${r0(b.upRatio)}% 的個股上漲。` });
  }
  if (b.above20 < 30) out.push({ tone: "warn", text: `只有 ${r0(b.above20)}% 的個股站在月線（20 日線）之上，短線整體偏弱。` });
  else if (b.above20 > 70) out.push({ tone: "good", text: `${r0(b.above20)}% 的個股站在月線之上，短線整體偏強；比例過高時也要留意追高風險。` });
  if (b.above60 < 30) out.push({ tone: "warn", text: `只有 ${r0(b.above60)}% 的個股站在季線（60 日線）之上，中期趨勢偏弱。` });
  if (b.newLow52 > b.newHigh52 * 2 && b.newLow52 >= 20) out.push({ tone: "warn", text: `創 52 週新低（${b.newLow52}）遠多於新高（${b.newHigh52}），弱勢股擴散中。` });
  if (valueRatio != null && valueRatio >= 1.5) out.push({ tone: "info", text: `成交值是 20 日均值的 ${valueRatio.toFixed(2)} 倍，量能明顯放大。` });
  else if (valueRatio != null && valueRatio <= 0.7) out.push({ tone: "info", text: `成交值只有 20 日均值的 ${valueRatio.toFixed(2)} 倍，量能萎縮，突破或跌破的可信度較低。` });
  if (!out.length) out.push({ tone: "info", text: "目前廣度沒有明顯失衡：指數漲跌與上漲家數大致一致。" });
  return out;
}
