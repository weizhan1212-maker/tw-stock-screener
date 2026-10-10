/**
 * 預設策略：5 套基本策略＋9 套大師策略＋單一條件策略（strategies-single.ts）。
 * 大師策略是依公開著作整理的台股量化近似版，非原作者背書；所有數字都可在頁面上調整。
 */
import type { Condition } from "./screener";
import { num, type Row } from "./screener";
import type { Sort } from "@/components/Results";
import { SINGLE } from "./strategies-single";

export interface Param {
  key: string;
  label: string;
  value: number;
  unit?: string;
  step?: number;
}

export type Params = Record<string, number>;

export interface Ctx {
  stocks: Row[];
  /** 某欄位在全部股票中的百分位（0 = 最小、100 = 最大）；positive 只算 > 0 的值 */
  pct: (field: string, positive?: boolean) => Map<string, number>;
  median: (field: string, positive?: boolean) => number | null;
  marketBull?: boolean;
}

export interface Strategy {
  id: string;
  name: string;
  group: "基本策略" | "大師策略" | "單一條件";
  /** 單一條件策略的分類 */
  category?: "技術面" | "籌碼面" | "基本面";
  author?: string;
  tagline: string;
  plain: string;
  params: Param[];
  rules: (p: Params) => string[];
  cols: string[];
  sort: Sort;
  run: (ctx: Ctx, p: Params) => Row[];
  /** 可以轉成自訂篩選條件的策略才有 */
  toConditions?: (p: Params) => Omit<Condition, "id">[];
  /** 用到的資料期間 */
  period?: string;
  /** 金融股怎麼處理 */
  finance?: string;
  /** 不適用情境 */
  notFor?: string[];
  /** 額外提醒（例如 CAN SLIM 的大盤狀態） */
  notice?: (ctx: Ctx) => string | null;
  /** 需要累積才有的資料：全市場都還沒有這個欄位時，卡片顯示 msg 而不是「0 檔」 */
  needs?: { field: string; msg: string };
}

/** 流動性門檻（只影響畫面顯示，回測不套用）：20 日均成交值至少 0.3 億（約一天 3,000 萬，太低的股票不好進出） */
export const MIN_AVG_VALUE = 0.3;
export const isLiquid = (r: Row) => (num(r.avg_value20) ?? 0) >= MIN_AVG_VALUE;
/** 全市場都還沒有累積資料 */
export const pending = (s: Strategy, rows: Row[]) => !!s.needs && !rows.some((r) => num(r[s.needs!.field]) != null);

const v = (r: Row, k: string) => num(r[k]);
const gt = (r: Row, k: string, x: number) => { const a = v(r, k); return a != null && a > x; };
const ge = (r: Row, k: string, x: number) => { const a = v(r, k); return a != null && a >= x; };
const lt = (r: Row, k: string, x: number) => { const a = v(r, k); return a != null && a < x; };
const le = (r: Row, k: string, x: number) => { const a = v(r, k); return a != null && a <= x; };
const between = (r: Row, k: string, lo: number, hi: number) => ge(r, k, lo) && le(r, k, hi);
const isTrue = (r: Row, k: string) => v(r, k) === 1;
const notFin = (r: Row) => v(r, "is_financial") !== 1;
const pctOf = (m: Map<string, number>, r: Row) => m.get(r.code as string);

export function makeCtx(rows: Row[], marketBull?: boolean): Ctx {
  const stocks = rows.filter((r) => r.sec_type === "stock");
  const cache = new Map<string, Map<string, number>>();
  return {
    stocks,
    marketBull,
    pct(field, positive = false) {
      const key = `${field}:${positive}`;
      if (!cache.has(key)) {
        const vals = stocks
          .map((r) => [r.code as string, v(r, field)] as const)
          .filter(([, x]) => x != null && (!positive || (x as number) > 0)) as [string, number][];
        vals.sort((a, b) => a[1] - b[1]);
        const n = vals.length;
        cache.set(key, new Map(vals.map(([c], i) => [c, n > 1 ? (i / (n - 1)) * 100 : 50])));
      }
      return cache.get(key)!;
    },
    median(field, positive = false) {
      const xs = stocks.map((r) => v(r, field)).filter((x): x is number => x != null && (!positive || x > 0)).sort((a, b) => a - b);
      if (!xs.length) return null;
      const m = Math.floor(xs.length / 2);
      return xs.length % 2 ? xs[m] : (xs[m - 1] + xs[m]) / 2;
    },
  };
}

export const defaults = (s: Strategy): Params => Object.fromEntries(s.params.map((p) => [p.key, p.value]));

const BASE_LIST: Strategy[] = [
  // ---------------- 基本策略 ----------------
  {
    id: "dividend",
    name: "存股",
    group: "基本策略",
    tagline: "高殖利率、年年配息、有在賺錢",
    plain: "找現金股利穩定、殖利率高的公司，適合想長期領股息的人。連續配息的年數越長，代表公司越有能力、也越願意分錢給股東。",
    params: [
      { key: "yield", label: "殖利率至少", value: 5, unit: "%", step: 0.5 },
      { key: "years", label: "連續配息至少", value: 5, unit: "年" },
    ],
    rules: (p) => [`現金殖利率 ≥ ${p.yield}%`, `連續配息 ≥ ${p.years} 年`, "近四季 EPS > 0"],
    cols: ["close", "chg_pct", "dividend_yield", "payout_ratio", "div_fill", "cash_div_12m", "div_years", "eps_ttm", "pe", "market_cap"],
    sort: { key: "dividend_yield", dir: -1 },
    run: (c, p) => c.stocks.filter((r) => ge(r, "dividend_yield", p.yield) && ge(r, "div_years", p.years) && gt(r, "eps_ttm", 0)),
    toConditions: (p) => [
      { field: "dividend_yield", op: "ge", a: p.yield },
      { field: "div_years", op: "ge", a: p.years },
      { field: "eps_ttm", op: "ge", a: 0.01 },
    ],
  },
  {
    id: "value",
    name: "價值",
    group: "基本策略",
    tagline: "本益比、股價淨值比都偏低",
    plain: "用便宜的價格買有賺錢的公司。本益比低代表回本快，股價淨值比低代表股價接近公司帳面價值。",
    params: [
      { key: "pe", label: "本益比低於", value: 12, unit: "倍" },
      { key: "pb", label: "股價淨值比低於", value: 1.5, unit: "倍", step: 0.1 },
    ],
    rules: (p) => [`本益比 < ${p.pe} 倍`, `股價淨值比 < ${p.pb} 倍`, "近四季 EPS > 0"],
    cols: ["close", "chg_pct", "pe", "pb", "eps_ttm", "dividend_yield", "market_cap"],
    sort: { key: "pe", dir: 1 },
    run: (c, p) => c.stocks.filter((r) => gt(r, "pe", 0) && lt(r, "pe", p.pe) && gt(r, "pb", 0) && lt(r, "pb", p.pb) && gt(r, "eps_ttm", 0)),
    toConditions: (p) => [
      { field: "pe", op: "between", a: 0.01, b: p.pe },
      { field: "pb", op: "between", a: 0.01, b: p.pb },
      { field: "eps_ttm", op: "ge", a: 0.01 },
    ],
  },
  {
    id: "growth",
    name: "成長",
    group: "基本策略",
    tagline: "營收連續大幅成長、獲利跟上",
    plain: "找營收連續幾個月都比去年同期大幅成長、而且獲利也在成長的公司。營收是最即時的成長訊號，每個月 10 號前公布。",
    params: [{ key: "rev", label: "近 3 月營收年增率都高於", value: 20, unit: "%" }],
    rules: (p) => [`月營收年增率 > ${p.rev}%，連續 3 個月`, "最近一季 EPS 年增 > 0"],
    cols: ["close", "chg_pct", "rev_yoy", "rev_yoy_min3", "rev_mom", "eps_q_yoy", "pe", "market_cap"],
    sort: { key: "rev_yoy", dir: -1 },
    run: (c, p) => c.stocks.filter((r) => gt(r, "rev_yoy_min3", p.rev) && gt(r, "eps_q_yoy", 0)),
    toConditions: (p) => [
      { field: "rev_yoy_min3", op: "ge", a: p.rev },
      { field: "eps_q_yoy", op: "ge", a: 0.01 },
    ],
  },
  {
    id: "momentum",
    name: "動能",
    group: "基本策略",
    tagline: "均線多頭、爆量創新高",
    plain: "找趨勢向上、今天又帶量突破的股票。均線多頭排列代表短中期趨勢一致向上，爆量創高代表有資金積極買進。",
    params: [{ key: "vol", label: "量比至少", value: 2, unit: "倍", step: 0.5 }],
    rules: (p) => ["收盤 > 5 日線 > 20 日線 > 60 日線", `量比 ≥ ${p.vol} 倍`, "收盤創 20 日新高"],
    cols: ["close", "chg_pct", "vol_ratio", "volume_lots", "ret20", "dist_high52", "market_cap"],
    sort: { key: "vol_ratio", dir: -1 },
    run: (c, p) => c.stocks.filter((r) => isTrue(r, "bull_align") && ge(r, "vol_ratio", p.vol) && isTrue(r, "new_high20")),
    toConditions: (p) => [
      { field: "bull_align", op: "is" },
      { field: "vol_ratio", op: "ge", a: p.vol },
      { field: "new_high20", op: "is" },
    ],
  },
  {
    id: "chips",
    name: "籌碼",
    group: "基本策略",
    tagline: "投信連買、外資同步站在買方",
    plain: "跟著法人走。投信（基金公司）連續買超常被視為「認養」，外資最近也在買，代表兩股主要資金方向一致。",
    params: [{ key: "days", label: "投信連買至少", value: 3, unit: "天" }],
    rules: (p) => [`投信連續買超 ≥ ${p.days} 天`, "外資近 5 日合計買超 > 0"],
    cols: ["close", "chg_pct", "trust_buy_streak", "trust_net5", "foreign_net5", "foreign_ratio", "market_cap"],
    sort: { key: "trust_buy_streak", dir: -1 },
    run: (c, p) => c.stocks.filter((r) => ge(r, "trust_buy_streak", p.days) && gt(r, "foreign_net5", 0)),
    toConditions: (p) => [
      { field: "trust_buy_streak", op: "ge", a: p.days },
      { field: "foreign_net5", op: "ge", a: 1 },
    ],
  },

  // ---------------- 大師策略 ----------------
  {
    id: "graham",
    name: "防禦型投資人",
    author: "班傑明・葛拉漢",
    group: "大師策略",
    tagline: "規模大、財務穩、長期賺錢又便宜",
    plain: "「價值投資之父」葛拉漢給一般投資人的選股法：只買規模夠大、財務穩健、多年來一直賺錢也一直配息，而且價格合理的公司。重點是先求不虧錢。",
    params: [
      { key: "cap", label: "市值排名前", value: 30, unit: "%" },
      { key: "cr", label: "流動比率高於", value: 2, unit: "倍", step: 0.1 },
      { key: "grow", label: "近 3 年 / 前 3 年平均 EPS 至少", value: 1.33, unit: "倍", step: 0.01 },
      { key: "pepb", label: "本益比 × 淨值比低於", value: 22.5, step: 0.5 },
    ],
    rules: (p) => ["排除金融股", `市值排名前 ${p.cap}%`, `流動比率 > ${p.cr}`, "近 5 年每年 EPS > 0",
      "連續配息 ≥ 5 年", `近 3 年平均 EPS ≥ 前 3 年平均 × ${p.grow}`, `本益比 × 股價淨值比 < ${p.pepb}`],
    cols: ["close", "chg_pct", "pe_pb", "pe", "pb", "current_ratio", "eps_growth_3v3", "div_years", "market_cap"],
    sort: { key: "pe_pb", dir: 1 },
    run: (c, p) => {
      const cap = c.pct("market_cap", true);
      return c.stocks.filter((r) => notFin(r) && (pctOf(cap, r) ?? -1) >= 100 - p.cap && gt(r, "current_ratio", p.cr)
        && gt(r, "eps_min5y", 0) && ge(r, "years_fin", 5) && ge(r, "div_years", 5)
        && ge(r, "eps_growth_3v3", p.grow) && gt(r, "pe_pb", 0) && lt(r, "pe_pb", p.pepb));
    },
  },
  {
    id: "buffett",
    name: "品質護城河",
    author: "巴菲特風格",
    group: "大師策略",
    tagline: "長期高 ROE、低負債、穩定賺現金",
    plain: "巴菲特偏好「有護城河」的好公司：長年用股東的錢賺很多（ROE 高）、不太借錢、真的有賺到現金、產品毛利穩定，再用合理價格買進。",
    params: [
      { key: "roe", label: "近 5 年每年 ROE 高於", value: 15, unit: "%" },
      { key: "debt", label: "負債比低於", value: 50, unit: "%" },
      { key: "gm", label: "毛利率穩定度至少", value: 80, unit: "%" },
      { key: "pe", label: "本益比低於", value: 25, unit: "倍" },
    ],
    rules: (p) => [`近 5 年每年 ROE > ${p.roe}%`, `負債比 < ${p.debt}%`, "近 3 年自由現金流每年 > 0",
      `近 5 年毛利率最低值 ≥ 最高值的 ${p.gm}%`, `本益比 < ${p.pe} 倍`],
    cols: ["close", "chg_pct", "roe", "roe_min5y", "debt_ratio", "gross_margin", "gm_stability", "pe", "market_cap"],
    sort: { key: "roe", dir: -1 },
    run: (c, p) => c.stocks.filter((r) => gt(r, "roe_min5y", p.roe) && lt(r, "debt_ratio", p.debt) && gt(r, "fcf_min3y", 0)
      && ge(r, "gm_stability", p.gm) && gt(r, "pe", 0) && lt(r, "pe", p.pe)),
    toConditions: (p) => [
      { field: "roe_min5y", op: "ge", a: p.roe },
      { field: "debt_ratio", op: "le", a: p.debt },
      { field: "gm_stability", op: "ge", a: p.gm },
      { field: "pe", op: "between", a: 0.01, b: p.pe },
    ],
  },
  {
    id: "magic",
    name: "神奇公式",
    author: "喬爾・葛林布雷",
    group: "大師策略",
    tagline: "好公司 × 便宜價，兩項排名加總",
    plain: "葛林布雷在《打敗大盤的獲利公式》裡的方法：同時找「很會賺錢」（資本報酬率高）和「很便宜」（盈餘殖利率高）的公司。兩個指標各自排名後相加，取總分最好的一批。",
    params: [
      { key: "cap", label: "市值至少", value: 50, unit: "億" },
      { key: "top", label: "取前幾名", value: 30, unit: "檔" },
    ],
    rules: (p) => ["排除金融、公用事業", `市值 ≥ ${p.cap} 億`, "盈餘殖利率 = 營業利益 ÷ 企業價值",
      "資本報酬率 = 營業利益 ÷（淨營運資金＋固定資產）", `兩項各自排名後相加，取前 ${p.top} 名`],
    cols: ["close", "chg_pct", "magic_rank", "earnings_yield", "roc", "pe", "market_cap"],
    sort: { key: "magic_rank", dir: 1 },
    run: (c, p) => {
      const pool = c.stocks.filter((r) => notFin(r) && v(r, "is_utility") !== 1 && ge(r, "market_cap", p.cap)
        && gt(r, "earnings_yield", 0) && gt(r, "roc", 0));
      const rank = (k: string) => {
        const s = [...pool].sort((a, b) => (v(b, k) as number) - (v(a, k) as number));
        return new Map(s.map((r, i) => [r.code as string, i + 1]));
      };
      const ey = rank("earnings_yield"), roc = rank("roc");
      const scored = pool.map((r) => ({ ...r, magic_score: ey.get(r.code as string)! + roc.get(r.code as string)! }));
      scored.sort((a, b) => (a.magic_score as number) - (b.magic_score as number));
      return scored.slice(0, p.top).map((r, i) => ({ ...r, magic_rank: i + 1 }));
    },
  },
  {
    id: "lynch",
    name: "PEG 成長股",
    author: "彼得・林區",
    group: "大師策略",
    tagline: "成長速度比本益比快",
    plain: "傳奇基金經理人彼得林區用 PEG（本益比 ÷ 盈餘成長率）找「成長被低估」的公司：PEG 小於 1 代表你付的價格比它成長的速度便宜。成長率太高通常不持久，所以設上限。",
    params: [
      { key: "peg", label: "PEG 低於", value: 1, step: 0.1 },
      { key: "gmin", label: "EPS 年成長率至少", value: 10, unit: "%" },
      { key: "gmax", label: "EPS 年成長率最多", value: 50, unit: "%" },
      { key: "debt", label: "負債比低於", value: 50, unit: "%" },
    ],
    rules: (p) => [`PEG（本益比 ÷ 近 3 年 EPS 年化成長率）< ${p.peg}`, `EPS 年化成長率 ${p.gmin}%–${p.gmax}%`, `負債比 < ${p.debt}%`],
    cols: ["close", "chg_pct", "peg", "pe", "eps_cagr3", "debt_ratio", "market_cap"],
    sort: { key: "peg", dir: 1 },
    run: (c, p) => c.stocks.filter((r) => gt(r, "peg", 0) && lt(r, "peg", p.peg) && between(r, "eps_cagr3", p.gmin, p.gmax) && lt(r, "debt_ratio", p.debt)),
    toConditions: (p) => [
      { field: "peg", op: "between", a: 0.01, b: p.peg },
      { field: "eps_cagr3", op: "between", a: p.gmin, b: p.gmax },
      { field: "debt_ratio", op: "le", a: p.debt },
    ],
  },
  {
    id: "canslim",
    name: "CAN SLIM",
    author: "威廉・歐尼爾",
    group: "大師策略",
    tagline: "獲利爆發、股價強勢、法人進場",
    plain: "歐尼爾研究百年飆股歸納出的 7 個特徵：當季與年度獲利大幅成長（C、A）、股價接近新高（N）、成交量放大（S）、比大盤強（L）、法人買進（I），而且大盤要在多頭（M）。",
    params: [
      { key: "c", label: "當季 EPS 年增至少（C）", value: 25, unit: "%" },
      { key: "n", label: "距 52 週高點在幾 % 內（N）", value: 15, unit: "%" },
      { key: "s", label: "量比至少（S）", value: 1.5, unit: "倍", step: 0.1 },
      { key: "l", label: "半年漲幅排名前（L）", value: 20, unit: "%" },
    ],
    rules: (p) => [`C：最近一季 EPS 年增 ≥ ${p.c}%`, "A：近 3 年年度 EPS 逐年成長", `N：距 52 週高點 ≤ ${p.n}%`,
      `S：量比 ≥ ${p.s}`, `L：近 120 日漲幅排名前 ${p.l}%`, "I：外資或投信近 20 日合計買超", "M：加權指數在 200 日均線之上"],
    cols: ["close", "chg_pct", "ret120", "eps_q_yoy", "dist_high52", "vol_ratio", "foreign_net20", "trust_net20", "market_cap"],
    sort: { key: "ret120", dir: -1 },
    run: (c, p) => {
      const rs = c.pct("ret120");
      return c.stocks.filter((r) => ge(r, "eps_q_yoy", p.c) && isTrue(r, "eps_up3y") && ge(r, "dist_high52", -p.n)
        && ge(r, "vol_ratio", p.s) && (pctOf(rs, r) ?? -1) >= 100 - p.l
        && (gt(r, "foreign_net20", 0) || gt(r, "trust_net20", 0)));
    },
    notice: (c) => (c.marketBull === false ? "大盤目前在 200 日均線之下（M 條件不成立），原策略建議觀望。" : null),
  },
  {
    id: "piotroski",
    name: "F-Score",
    author: "約瑟夫・皮爾托斯基",
    group: "大師策略",
    tagline: "便宜股裡挑財務正在變好的",
    plain: "史丹佛教授皮爾托斯基發現：便宜股（股價淨值比低）裡，財務體質正在改善的那些表現特別好。他用 9 項簡單檢查打分數（賺錢、現金流、負債、效率有沒有變好），8 分以上算優等生。",
    params: [
      { key: "score", label: "F-Score 至少", value: 8, unit: "分" },
      { key: "pb", label: "股價淨值比位於最低", value: 20, unit: "%" },
    ],
    rules: (p) => ["排除金融股", `F-Score ≥ ${p.score}（9 項：ROA>0、營業現金流>0、ROA 改善、現金流>淨利、長期負債比下降、流動比率上升、沒有增資、毛利率上升、資產周轉率上升）`, `股價淨值比位於全市場最低 ${p.pb}%`],
    cols: ["close", "chg_pct", "f_score", "pb", "roa", "debt_ratio", "market_cap"],
    sort: { key: "f_score", dir: -1 },
    run: (c, p) => {
      const pb = c.pct("pb", true);
      return c.stocks.filter((r) => notFin(r) && ge(r, "f_score", p.score) && (pctOf(pb, r) ?? 101) <= p.pb);
    },
  },
  {
    id: "fisher",
    name: "股價營收比",
    author: "肯恩・費雪",
    group: "大師策略",
    tagline: "用營收找被市場冷落的公司",
    plain: "費雪認為獲利會起伏，但營收比較穩。股價營收比（PSR）很低，代表市場對公司的營收給的價格很低；再加上營收還在成長、負債不高，就是被冷落的好機會。",
    params: [
      { key: "psr", label: "股價營收比低於", value: 0.75, step: 0.05 },
      { key: "debt", label: "負債比低於", value: 50, unit: "%" },
    ],
    rules: (p) => [`股價營收比 < ${p.psr}`, "近 12 個月營收年增 > 0", `負債比 < ${p.debt}%`],
    cols: ["close", "chg_pct", "psr", "rev_ttm_yoy", "debt_ratio", "pe", "market_cap"],
    sort: { key: "psr", dir: 1 },
    run: (c, p) => c.stocks.filter((r) => gt(r, "psr", 0) && lt(r, "psr", p.psr) && gt(r, "rev_ttm_yoy", 0) && lt(r, "debt_ratio", p.debt)),
    toConditions: (p) => [
      { field: "psr", op: "between", a: 0.001, b: p.psr },
      { field: "rev_ttm_yoy", op: "ge", a: 0.01 },
      { field: "debt_ratio", op: "le", a: p.debt },
    ],
  },
  {
    id: "neff",
    name: "低本益比總報酬",
    author: "約翰・聶夫",
    group: "大師策略",
    tagline: "冷門、穩定成長、還有股息",
    plain: "溫莎基金經理人聶夫專買「沒人要」的低本益比股票，但要求穩定成長加上股息。他用總報酬比（成長率＋殖利率）÷ 本益比衡量划不划算。",
    params: [
      { key: "below", label: "本益比低於市場中位數", value: 40, unit: "%" },
      { key: "gmin", label: "EPS 年成長率至少", value: 7, unit: "%" },
      { key: "gmax", label: "EPS 年成長率最多", value: 20, unit: "%" },
      { key: "ratio", label: "總報酬比至少為市場中位數的", value: 2, unit: "倍", step: 0.1 },
    ],
    rules: (p) => [`本益比低於全市場中位數 ${p.below}% 以上`, `EPS 年化成長率 ${p.gmin}%–${p.gmax}%`,
      `總報酬比（(EPS 成長率 + 殖利率) ÷ 本益比）≥ 市場中位數 × ${p.ratio}`],
    cols: ["close", "chg_pct", "neff_ratio", "pe", "eps_cagr3", "dividend_yield", "market_cap"],
    sort: { key: "neff_ratio", dir: -1 },
    run: (c, p) => {
      const mpe = c.median("pe", true), mr = c.median("neff_ratio", true);
      if (mpe == null || mr == null) return [];
      return c.stocks.filter((r) => gt(r, "pe", 0) && le(r, "pe", mpe * (1 - p.below / 100))
        && between(r, "eps_cagr3", p.gmin, p.gmax) && ge(r, "neff_ratio", mr * p.ratio));
    },
  },
  {
    id: "dreman",
    name: "逆向投資",
    author: "大衛・德雷曼",
    group: "大師策略",
    tagline: "全市場最便宜的一群裡挑體質好的",
    plain: "德雷曼主張市場常對壞消息反應過度，所以專買估值最低的股票。但他會檢查財務體質，避開真的出問題的公司，並要求股息高於平均。",
    params: [
      { key: "low", label: "估值位於最低", value: 20, unit: "%" },
      { key: "cap", label: "市值排名前", value: 50, unit: "%" },
      { key: "cr", label: "流動比率高於", value: 1.5, unit: "倍", step: 0.1 },
      { key: "debt", label: "負債比低於", value: 50, unit: "%" },
    ],
    rules: (p) => [`本益比、股價淨值比、股價現金流比三項中，至少兩項位於全市場最低 ${p.low}%`, `市值排名前 ${p.cap}%`,
      `流動比率 > ${p.cr}`, `負債比 < ${p.debt}%`, "殖利率高於市場中位數"],
    cols: ["close", "chg_pct", "pe", "pb", "pcf", "dividend_yield", "current_ratio", "debt_ratio", "market_cap"],
    sort: { key: "pe", dir: 1 },
    run: (c, p) => {
      const pe = c.pct("pe", true), pb = c.pct("pb", true), pcf = c.pct("pcf", true), cap = c.pct("market_cap", true);
      const my = c.median("dividend_yield", true) ?? 0;
      return c.stocks.filter((r) => {
        const cheap = [pe, pb, pcf].filter((m) => (pctOf(m, r) ?? 101) <= p.low).length;
        return cheap >= 2 && (pctOf(cap, r) ?? -1) >= 100 - p.cap && gt(r, "current_ratio", p.cr)
          && lt(r, "debt_ratio", p.debt) && gt(r, "dividend_yield", my);
      });
    },
  },
];

const FIN_ALL = "金融股與一般股票一起計算。";
const FIN_OUT = "排除金融股（銀行、保險、證券的財報結構不同，這些指標不適用）。";

/** 公開每套策略的資料期間、金融股處理與不適用情境 */
const DISCLOSE: Record<string, Pick<Strategy, "period" | "finance" | "notFor">> = {
  dividend: { period: "殖利率＝最近一年度現金股利 ÷ 最新收盤價；配息年數依歷年股利資料；EPS 為近四季合計。", finance: FIN_ALL,
    notFor: ["獲利正在衰退、未來股利可能縮水的公司", "想賺短期價差的人：高殖利率股通常漲得慢", "除息後殖利率會依新股利重新計算，數字可能跳動"] },
  value: { period: "本益比用近四季 EPS、股價淨值比用最新一季淨值。", finance: FIN_ALL,
    notFor: ["產業長期衰退的公司（便宜是有原因的，即價值陷阱）", "景氣循環股在景氣高點時本益比最低，反而是賣點"] },
  growth: { period: "最近 3 個月月營收、最新一季 EPS。", finance: FIN_ALL,
    notFor: ["去年同期基期很低時，年增率會被放大", "營收成長但毛利下滑、賺不到錢的公司", "成長股估值通常偏高，成長一放緩股價就大跌"] },
  momentum: { period: "近 60 個交易日的還原收盤價與近 20 日成交量。", finance: FIN_ALL,
    notFor: ["盤整盤：突破後常常又跌回來", "大盤轉空時，動能股通常跌最兇", "沒有看公司基本面，題材股也會入選"] },
  chips: { period: "證交所／櫃買中心每日三大法人買賣超（投信連買天數、外資近 5 日）。", finance: FIN_ALL,
    notFor: ["季底投信作帳、或 ETF 成分股調整造成的被動買超", "法人也會停損，連買中斷後可能反向賣超"] },
  graham: { period: "市值用最新收盤價；流動比率用最新一季；EPS 與配息看近 5～6 年年報。", finance: FIN_OUT,
    notFor: ["高成長科技股：條件偏保守，幾乎選不到", "近年才上市、財報不滿 5 年的公司", "原著還有質化判斷（產業地位、管理層），這裡沒有"] },
  buffett: { period: "ROE 看近 5 年年報；負債比用最新一季；自由現金流看近 3 年；毛利率穩定度看近 5 年。", finance: "金融股沒有毛利率與自由現金流資料，實際上不會入選。",
    notFor: ["護城河是質化判斷（品牌、專利、轉換成本），數字只能近似", "剛轉型或景氣循環股：過去 5 年的數字無法代表未來", "本書作者沒有公開固定選股公式，這是依其公開談話整理的近似條件"] },
  magic: { period: "營業利益用近四季；企業價值與資本用最新一季資產負債表。", finance: "排除金融與公用事業（原著做法）。",
    notFor: ["原著建議一次買 20～30 檔、持有一年再換，單挑幾檔效果差很多", "獲利剛衰退但還沒反映在近四季數字的公司"] },
  lynch: { period: "本益比用近四季 EPS；EPS 成長率為近 3 年年化；負債比用最新一季。", finance: FIN_ALL,
    notFor: ["景氣循環股：EPS 成長率起伏大，PEG 失真", "原著強調要懂公司在做什麼，數字只是第一步", "成長率是過去的，不代表未來"] },
  canslim: { period: "當季 EPS、近 3 年年度 EPS、近 250 日股價、近 20 日法人買賣超。", finance: FIN_ALL,
    notFor: ["大盤空頭（M 條件不成立）：原策略建議觀望", "原著搭配嚴格停損（約 7～8%），只選股不停損風險很大", "台股沒有公開的「新產品、新管理層」（N 的另一半）資料"] },
  piotroski: { period: "9 項檢查用最近兩個年度的財報比較；股價淨值比用最新一季。", finance: FIN_OUT,
    notFor: ["高估值成長股：本策略只在便宜股裡挑", "原研究是美國市場、持有一年的平均結果，個別股票差異很大"] },
  fisher: { period: "股價營收比用近 12 個月營收；營收成長看近 12 個月對前 12 個月；負債比用最新一季。", finance: FIN_ALL,
    notFor: ["毛利很低的產業（通路、代工）：營收大但賺很少，PSR 天生低", "營收成長但持續虧損的公司"] },
  neff: { period: "本益比用近四季 EPS；EPS 成長率為近 3 年年化；殖利率用最近一年度現金股利。", finance: FIN_ALL,
    notFor: ["市場追逐熱門成長股的階段：低本益比股可能長期落後", "獲利正在衰退的公司（過去的成長率會高估）"] },
  dreman: { period: "本益比、股價淨值比、股價現金流比都用最新收盤價與最近財報；殖利率用最近一年度現金股利。", finance: FIN_ALL,
    notFor: ["真的出問題的公司（逆向投資最怕接到掉下來的刀子）", "原著建議分散持有且耐心等待，短期可能繼續下跌"] },
};

export const STRATEGIES: Strategy[] = [...BASE_LIST.map((s) => ({ ...s, ...DISCLOSE[s.id] })), ...SINGLE];

export const STRATEGY_MAP = Object.fromEntries(STRATEGIES.map((s) => [s.id, s]));
