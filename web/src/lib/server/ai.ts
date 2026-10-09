/**
 * AI 個股解讀（伺服器端）：
 * - 事實資料由伺服器自己從快照與個股檔算好（不採用瀏覽器傳來的內容，因為結果會共用給所有人），
 *   並附上「比較對象」：五因子全市場百分位、同產業中位數、自己過去的位置，讓模型有東西可以解讀。
 * - 模型負責歸納：定位、看多理由、主要風險、什麼情況代表故事變了、接下來追蹤什麼。
 * - 數字只能來自事實資料（輸出後逐一檢查）；不給買賣建議、目標價、進出場、停損停利。
 * 金鑰：GEMINI_API_KEY；模型：GEMINI_MODEL（預設 gemini-3.5-flash），額度用完或不支援時改用 GEMINI_FALLBACK_MODEL（預設 gemini-3.1-flash-lite）。
 */
import "server-only";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { FIELD_MAP, FIELDS } from "@/lib/fields";
import { decode, fmtUnit, num, type RawSnapshot, type Row, type Snapshot } from "@/lib/screener";
import { focusTags, grade, industryRank, outlooks, type StockFile } from "@/lib/stock";
import { getCachedBytes } from "@/lib/storage";

export const aiEnabled = () => !!process.env.GEMINI_API_KEY;
export const aiModel = () => process.env.GEMINI_MODEL || "gemini-3.5-flash";
export const aiFallbackModel = () => process.env.GEMINI_FALLBACK_MODEL || "gemini-3.1-flash-lite";

const unzip = (buf: Buffer | ArrayBuffer) => {
  const b = Buffer.from(buf as ArrayBuffer);
  return JSON.parse((b[0] === 0x1f ? gunzipSync(b) : b).toString("utf8"));
};

export async function loadSnapshot(): Promise<Snapshot | null> {
  const file = process.env.SNAPSHOT_FILE;
  if (file && !process.env.VERCEL) return decode(unzip(await readFile(file)) as RawSnapshot);
  const buf = await getCachedBytes("site/snapshot.json.gz", 300_000);
  return buf ? decode(unzip(buf) as RawSnapshot) : null;
}

export async function loadStock(code: string): Promise<StockFile | null> {
  if (process.env.STOCK_DIR && !process.env.VERCEL) {
    try { return unzip(await readFile(`${process.env.STOCK_DIR}/${code}.json.gz`)) as StockFile; } catch { return null; }
  }
  const buf = await getCachedBytes(`site/stock/${code}.json.gz`, 300_000);
  return buf ? (unzip(buf) as StockFile) : null;
}

// ---------------- 比較對象：五因子、同業、全市場 ----------------

type Dir = 1 | -1;
interface FactorDef { key: FactorKey; label: string; basis: string; items: [string, Dir][] }
export type FactorKey = "value" | "growth" | "quality" | "momentum" | "chips";
export interface Factor { key: FactorKey; label: string; pct: number | null; basis: string }

/** 每個因子由幾個欄位組成；每個欄位先算全市場百分位（越好越高），再取平均。 */
const FACTORS: FactorDef[] = [
  { key: "value", label: "價值", basis: "盈餘殖利率、本益比、股價淨值比、殖利率、股價營收比", items: [["earnings_yield", 1], ["pe", -1], ["pb", -1], ["dividend_yield", 1], ["psr", -1]] },
  { key: "growth", label: "成長", basis: "月營收年增率、近 12 月營收年增率、單季 EPS 年增率、EPS 3 年年化成長率", items: [["rev_yoy", 1], ["rev_ttm_yoy", 1], ["eps_q_yoy", 1], ["eps_cagr3", 1]] },
  { key: "quality", label: "品質", basis: "ROE、毛利率、營業利益率、F-Score、財務健康度、負債比", items: [["roe", 1], ["gross_margin", 1], ["op_margin", 1], ["f_score", 1], ["health_score", 1], ["debt_ratio", -1]] },
  { key: "momentum", label: "動能", basis: "近 20／60／120／240 日漲幅", items: [["ret20", 1], ["ret60", 1], ["ret120", 1], ["ret240", 1]] },
  { key: "chips", label: "籌碼", basis: "法人 20 日買賣超金額占市值、千張大戶週增減、外資持股比", items: [["_inst_cap", 1], ["big_pct_chg", 1], ["foreign_ratio", 1]] },
];

/** 本益比、股價淨值比、股價營收比只算正數（虧損或淨值為負時沒有意義）。 */
const POSITIVE_ONLY = new Set(["pe", "pb", "psr"]);
const val = (r: Row, key: string): number | null => {
  if (key === "_inst_cap") {
    const a = num(r.inst_amt20), c = num(r.market_cap);
    return a != null && c != null && c > 0 ? a / c : null;
  }
  const v = num(r[key]);
  if (v == null || (POSITIVE_ONLY.has(key) && v <= 0)) return null;
  return v;
};

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** 百分位：比多少比例的股票好（0～100，整數）。 */
const pctRank = (sorted: number[], x: number, dir: Dir) => {
  let lo = 0, eq = 0;
  for (const v of sorted) { if (v < x) lo++; else if (v === x) eq++; }
  const below = (lo + eq / 2) / sorted.length;
  return Math.round((dir === 1 ? below : 1 - below) * 100);
};

const cache = new WeakMap<Snapshot, Map<string, number[]>>();
function columnSorted(snap: Snapshot, key: string): number[] {
  let m = cache.get(snap);
  if (!m) { m = new Map(); cache.set(snap, m); }
  let arr = m.get(key);
  if (!arr) {
    arr = snap.rows.filter((r) => r.sec_type === "stock").map((r) => val(r, key)).filter((v): v is number => v != null).sort((a, b) => a - b);
    m.set(key, arr);
  }
  return arr;
}

/** 五因子全市場百分位（伺服器計算，不經過 AI）。 */
export function scorecard(snap: Snapshot, code: string): Factor[] {
  const me = snap.rows.find((r) => r.code === code);
  if (!me) return [];
  return FACTORS.map((f) => {
    const ps: number[] = [];
    for (const [k, dir] of f.items) {
      const x = val(me, k);
      const col = columnSorted(snap, k);
      if (x != null && col.length >= 50) ps.push(pctRank(col, x, dir));
    }
    // 至少要有一半的組成欄位才給分
    const pct = ps.length * 2 >= f.items.length ? Math.round(ps.reduce((a, b) => a + b, 0) / ps.length) : null;
    return { key: f.key, label: f.label, pct, basis: f.basis };
  });
}

/** 跟同產業、全市場比的欄位（dir：數字越大越「高」的意思，用來說排第幾高）。 */
const PEER_KEYS = ["pe", "pb", "psr", "dividend_yield", "roe", "gross_margin", "op_margin", "rev_yoy", "eps_q_yoy", "ret120", "dist_ma240", "atr_pct", "foreign_ratio"];

function peerLines(snap: Snapshot, code: string): { lines: string[]; n: number; ind: string } | null {
  const me = snap.rows.find((r) => r.code === code);
  const ind = me?.ind ? String(me.ind) : "";
  if (!me) return null;
  const stocks = snap.rows.filter((r) => r.sec_type === "stock");
  const peers = ind ? stocks.filter((r) => r.ind === ind) : [];
  const usePeers = peers.length >= 5;
  const lines: string[] = [];
  for (const k of PEER_KEYS) {
    const f = FIELD_MAP[k];
    const x = val(me, k);
    if (!f || x == null) continue;
    const mv = stocks.map((r) => val(r, k)).filter((v): v is number => v != null);
    const mkt = mv.length >= 50 ? median(mv) : null;
    const pv = usePeers ? peers.map((r) => val(r, k)).filter((v): v is number => v != null) : [];
    const pm = pv.length >= 5 ? median(pv) : null;
    if (pm == null && mkt == null) continue;
    const parts = [`本股 ${fmtUnit(x, f.format)}`];
    if (pm != null) parts.push(`同業中位數 ${fmtUnit(pm, f.format)}`, `同業由高到低排第 ${1 + pv.filter((v) => v > x).length}、由低到高排第 ${1 + pv.filter((v) => v < x).length}（共 ${pv.length} 檔）`);
    if (mkt != null) parts.push(`全市場中位數 ${fmtUnit(mkt, f.format)}`);
    lines.push(`${f.label}：${parts.join("｜")}`);
  }
  return { lines, n: peers.length, ind };
}

// ---------------- 事實資料 ----------------

const SECTIONS: { title: string; keys: string[] }[] = [
  { title: "價量", keys: ["close", "chg_pct", "volume_lots", "value", "vol_ratio", "market_cap"] },
  { title: "技術面", keys: ["ret5", "ret20", "ret60", "ret120", "ret240", "rs20", "rs60", "dist_high52", "dist_low52", "dist_ma240", "above_ma20", "above_ma60", "above_ma240", "bull_align", "k", "d", "rsi14", "macd_hist", "boll_pctb", "atr_pct"] },
  { title: "估值", keys: ["pe", "pb", "dividend_yield", "psr", "peg"] },
  { title: "基本面", keys: ["eps_ttm", "eps_q", "eps_q_yoy", "eps_cagr3", "rev_yoy", "rev_yoy_min3", "rev_yoy_chg", "rev_ttm_yoy", "gross_margin", "op_margin", "net_margin", "roe", "debt_ratio", "fcf_ttm", "f_score", "health_score", "div_years"] },
];

const SIGNED = /^(chg_pct|ret\d+|rs\d+|dist_|rev_yoy|rev_ttm_yoy|eps_q_yoy|eps_cagr3|macd_hist)|_net\d*$|_chg/;

const line = (r: Row, key: string) => {
  const f = FIELD_MAP[key];
  const v = r[key];
  if (!f || v == null) return null;
  return `${f.label}：${fmtUnit(v, f.format, SIGNED.test(key))}`;
};

export interface Facts { code: string; name: string; asof: string; text: string; factors: Factor[] }

/** 把一檔股票整理成給模型看的事實清單；找不到資料回傳 null。 */
export function buildFacts(code: string, snap: Snapshot, s: StockFile): Facts | null {
  const row = snap.rows.find((r) => r.code === code);
  if (!row) return null;
  const name = String(row.name ?? s.info?.name ?? code);
  const out: string[] = [`股票：${name}（${code}）　市場：${s.info?.market ?? "—"}　產業：${row.ind ?? s.info?.industry ?? "—"}`, `價量與估值資料日：${snap.meta.asof}`];

  for (const sec of SECTIONS) {
    const ls = sec.keys.map((k) => line(row, k)).filter(Boolean) as string[];
    if (sec.title === "基本面" && num(row.health_score) != null) ls.push(`財務健康評級：${grade(num(row.health_score))}`);
    if (sec.title === "基本面") {
      const rk = industryRank(snap.rows, code);
      if (rk) ls.push(`財務健康度同產業排名：第 ${rk.rank} 名／共 ${rk.total} 檔`);
    }
    if (sec.title === "技術面") for (const o of outlooks(row)) if (o.state !== "資料不足") ls.push(`${o.label}（${o.span}）狀態：${o.state}`);
    if (ls.length) out.push(`\n【${sec.title}】`, ...ls);
  }

  // 五因子
  const factors = scorecard(snap, code);
  const fl = factors.filter((f) => f.pct != null).map((f) => `${f.label}：贏過全市場 ${f.pct}% 的股票（依${f.basis}）`);
  if (fl.length) out.push(`\n【五因子全市場百分位】（0～100，越高越好；價值高＝相對便宜）`, ...fl);

  // 同業、全市場
  const pr = peerLines(snap, code);
  if (pr?.lines.length) out.push(pr.n >= 5 ? `\n【和同產業（${pr.ind}，${pr.n} 檔）及全市場比較】` : `\n【和全市場比較】`, ...pr.lines);

  // 籌碼
  const chips = FIELDS.filter((f) => f.group === "籌碼面").map((f) => line(row, f.key)).filter(Boolean) as string[];
  const margin = snap.meta.margin_asof && snap.meta.margin_asof < snap.meta.asof ? `（融資融券與外資持股資料到 ${snap.meta.margin_asof}，比價格晚一天）` : "";
  if (chips.length) out.push(`\n【籌碼面】${margin}`, ...chips);
  const hold = (s.holders ?? []).slice(-4).filter((h) => h.big != null).map((h) => `${h.d}：${(h.big as number).toFixed(2)}%`);
  if (hold.length >= 2) out.push(`\n【千張大戶持股比（週）】`, hold.join("；"));
  const tags = focusTags(snap.rows, code).slice(0, 6).map((t) => `${t.label}第 ${t.rank} 名`);
  if (tags.length) out.push(`\n【全市場排名】`, tags.join("、"));

  // 月營收：年增率與自己過去的位置
  const rev = s.revenue ?? [];
  const yoy: string[] = [];
  for (const [m, v] of rev.slice(-6)) {
    const prevKey = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
    const p = rev.find(([k]) => k === prevKey)?.[1];
    if (v != null && p != null && p > 0) yoy.push(`${m}：${(((v / p) - 1) * 100).toFixed(2)}%`);
  }
  if (yoy.length) out.push(`\n【近月營收年增率】`, yoy.join("；"));
  const recent = rev.slice(-36).filter(([, v]) => v != null) as [string, number][];
  if (recent.length >= 12) {
    const [lm, lv] = recent[recent.length - 1];
    const rank = 1 + recent.filter(([, v]) => v > lv).length;
    out.push(`最新月營收（${lm}）在近 ${recent.length} 個月中排第 ${rank} 高`);
  }

  // 近 6 季財報（看趨勢）
  const qs = (s.quarters ?? []).slice(-6).map((q) => {
    const parts = [q.eps != null ? `EPS ${q.eps.toFixed(2)} 元` : null, q.gm != null ? `毛利率 ${q.gm.toFixed(2)}%` : null, q.om != null ? `營益率 ${q.om.toFixed(2)}%` : null, q.nm != null ? `淨利率 ${q.nm.toFixed(2)}%` : null].filter(Boolean);
    return parts.length ? `${q.p}：${parts.join("，")}` : null;
  }).filter(Boolean);
  if (qs.length) out.push(`\n【近幾季財報】`, ...(qs as string[]));

  // 股利
  const divs = (s.dividends ?? []).slice(-4).filter((d) => d.cash != null).map((d) => `${d.period}：現金 ${(d.cash as number).toFixed(2)} 元`);
  if (divs.length) out.push(`\n【近幾次股利】`, divs.join("；"));

  // 公告與法說會
  const ev = s.events;
  const news = (ev?.recent ?? []).slice(0, 4).map((e) => `${e.d} ${e.s.replace(/\s+/g, " ").slice(0, 60)}`);
  const conf = (ev?.conf ?? []).filter((c) => c.d >= snap.meta.asof).slice(0, 2).map((c) => `${c.d}${c.t ? ` ${c.t}` : ""} 法說會`);
  if (news.length || conf.length) out.push(`\n【近期公告與事件】`, ...news, ...conf);

  return { code, name, asof: snap.meta.asof, text: out.join("\n"), factors };
}

// ---------------- 呼叫模型 ----------------

export interface AiPoint { title: string; text: string }
export interface AiOutput { positioning: string; headline: string; bulls: AiPoint[]; risks: AiPoint[]; change: string; watch: string[] }
export interface Usage { inTokens: number; outTokens: number; thoughtTokens: number }

const SYSTEM = `你是資深台股研究員，替一般散戶寫「個股解讀」。讀者在同一頁已經看得到所有原始數字，不需要你複述；你的價值在於解讀：把數字放到同業、全市場、自己過去裡比較，說出這代表什麼、哪些是真正的優勢、哪些是風險。
規則：
1. 數字只能來自事實資料並原樣照抄（含小數與單位），不得自己計算、換算或四捨五入。只有 change 與 watch 可以用整數門檻（例如 50%）。
2. 每一點都要有比較對象（同業中位數、全市場、五因子百分位、自己過去幾季或幾個月），並用一句話說明「這代表什麼」。只列數字不解讀的句子不要寫。
3. 只挑最重要的。bulls 2～3 點、risks 2～3 點（依嚴重程度由高到低）；每點 title 14 字內、text 50～100 字。
4. 不得出現任何操作字眼：買進、賣出、加碼、減碼、進場、出場、停損、停利、目標價、推薦、看好、看壞；也不要預測股價會漲或跌，不寫「提供支撐」「下檔有限」「上漲空間」「出現轉機」這類暗示後市的說法。可以說估值偏高或偏低、是否過熱、股價可能已反映多少。
5. 資料不足或標示「—」的項目直接略過，不要猜。資料彼此矛盾時要點出來（例如營收大增但毛利率下滑、股價大漲但法人在賣）。
6. 「連續」「逐季」「創高」「持續」「加溫」這類趨勢詞，只能在資料直接看得出來時使用；例如週資料只有兩筆，只能說「較上週增加」；最新一個月比前一個月低，就不能說持續加溫。
   排名一律照抄資料裡的寫法（「由高到低排第 N」或「由低到高排第 N」），不要自己換算或改成「倒數」。
7. 不得推測原因或資料裡沒有的事（產品組合、訂單、客戶、產能、產業景氣等）。只說資料顯示什麼、代表什麼。
8. 籌碼要同時看當日、5 日、20 日；短期與 20 日方向相反時要明白說出來，不要只挑一邊。
9. positioning：2～3 個短詞描述這檔股票的樣貌，用「、」分隔，20 字內，例如「高成長、高估值、短線過熱」。
10. headline：一句話（45 字內）說出最關鍵的觀察。
11. change：出現什麼具體、可觀察的情況代表目前的狀況改變了（1～2 個條件，60 字內）。這是觀察條件，不是停損。
12. watch：接下來最值得追蹤的 3 件事，每件 30 字內，具體寫出指標或時間點。
13. 台灣慣用的繁體中文白話；必要的術語用括號簡短解釋。
只輸出 JSON。`;

const POINT = { type: "OBJECT", properties: { title: { type: "STRING" }, text: { type: "STRING" } }, required: ["title", "text"] };
const SCHEMA = {
  type: "OBJECT",
  properties: {
    positioning: { type: "STRING" },
    headline: { type: "STRING" },
    bulls: { type: "ARRAY", items: POINT },
    risks: { type: "ARRAY", items: POINT },
    change: { type: "STRING" },
    watch: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["positioning", "headline", "bulls", "risks", "change", "watch"],
};

/** 從寬到嚴的參數組合：參數不被接受（400）時自動換下一組，並記住每個模型成功的那組。 */
const LEVELS = ["full", "no-thinking", "json-only"] as const;
const levelOf = new Map<string, number>();

export class AiError extends Error {
  constructor(public code: "no_key" | "quota" | "bad_output" | "upstream" | "no_model", message: string, public detail?: string) { super(message); }
}

async function callOnce(model: string, factsText: string, extra: string, lv: (typeof LEVELS)[number]) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("no_key", "尚未啟用 AI 摘要");
  const gen: Record<string, unknown> = { temperature: 0.4, maxOutputTokens: 6000, responseMimeType: "application/json" };
  if (lv === "full") { gen.responseSchema = SCHEMA; gen.thinkingConfig = { thinkingLevel: "low" }; }
  if (lv === "no-thinking") gen.responseSchema = SCHEMA;
  const base = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/$/, "");   // 只有測試時會改
  const res = await fetch(`${base}/v1beta/models/${model}:generateContent`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(50_000),
    headers: { "x-goog-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: `事實資料：\n${factsText}${extra}` }] }],
      generationConfig: gen,
    }),
  });
  const body = await res.text();
  return { status: res.status, body };
}

interface GeminiResp {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
}

async function generate(model: string, factsText: string, extra = ""): Promise<{ out: AiOutput; usage: Usage }> {
  let lv = levelOf.get(model) ?? 0;
  let r = await callOnce(model, factsText, extra, LEVELS[lv]);
  while (r.status === 400 && lv < LEVELS.length - 1) {
    console.warn(`[ai] ${model} 400（${LEVELS[lv]}）：${r.body.slice(0, 300)}`);
    lv++;
    r = await callOnce(model, factsText, extra, LEVELS[lv]);
  }
  levelOf.set(model, lv);
  if (r.status === 429) throw new AiError("quota", "Google 的免費額度暫時用完了，請稍後再試", `${model} ${r.body.slice(0, 300)}`);
  if (r.status === 404) throw new AiError("no_model", "AI 服務暫時無法使用，請稍後再試", `${model} ${r.body.slice(0, 300)}`);
  if (r.status !== 200) {
    console.error(`[ai] ${model} ${r.status}：${r.body.slice(0, 400)}`);
    throw new AiError("upstream", "AI 服務暫時無法使用，請稍後再試", `${model} ${r.status} ${r.body.slice(0, 300)}`);
  }
  const j = JSON.parse(r.body) as GeminiResp;
  const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  let out: AiOutput;
  try { out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as AiOutput; }
  catch { throw new AiError("bad_output", "AI 回覆的格式不對，請再試一次", `${model} finish=${j.candidates?.[0]?.finishReason} ${text.slice(0, 200)}`); }
  const u = j.usageMetadata ?? {};
  return { out, usage: { inTokens: u.promptTokenCount ?? 0, outTokens: u.candidatesTokenCount ?? 0, thoughtTokens: u.thoughtsTokenCount ?? 0 } };
}

// ---------------- 輸出檢查 ----------------

const BANNED = /(建議(?:買|賣|進|出|加|減|持|布局|投資人|停|您|大家)|買進|賣出|買入|加碼|減碼|進場|出場|停損|停利|目標價|值得買|不要買|可以買|應該買|推薦|看好|看壞|看漲|看跌|必漲|必跌|穩賺|保證|轉強可期|有望|預期將|預計將|可望)/;

const isPoints = (x: unknown): x is AiPoint[] => Array.isArray(x) && x.every((p) => p && typeof p.title === "string" && typeof p.text === "string");

/** 檢查：結構完整、沒有操作字眼、數字都出現在事實資料中。回傳問題清單（空＝通過）。 */
export function validate(o: AiOutput, factsText: string): string[] {
  if (!o || typeof o.positioning !== "string" || typeof o.headline !== "string" || typeof o.change !== "string"
    || !isPoints(o.bulls) || !isPoints(o.risks) || !o.bulls.length || !o.risks.length
    || !Array.isArray(o.watch) || !o.watch.every((w) => typeof w === "string")) return ["結構不完整"];
  const problems: string[] = [];
  const strict = [o.positioning, o.headline, ...o.bulls.flatMap((p) => [p.title, p.text]), ...o.risks.flatMap((p) => [p.title, p.text])];
  const loose = [o.change, ...o.watch];                 // 觀察條件可以用整數門檻
  const hit = [...strict, ...loose].map((t) => t.match(BANNED)?.[0]).filter(Boolean);
  if (hit.length) problems.push(`出現不允許的字眼：${[...new Set(hit)].join("、")}`);
  const pool = factsText.replace(/,/g, "");
  const bad = new Set<string>();
  const check = (t: string, allowRound: boolean) => {
    for (const m of t.replace(/,/g, "").matchAll(/-?\d+(?:\.\d+)?/g)) {
      const n = m[0].replace(/^-/, "");
      if (/^\d{1,2}$/.test(n)) continue;                 // 期間、順位、百分位這類小整數不查
      if (allowRound && /^\d+$/.test(n) && Number(n) % 10 === 0) continue;
      if (!pool.includes(n)) bad.add(m[0]);
    }
  };
  strict.forEach((t) => check(t, false));
  loose.forEach((t) => check(t, true));
  if (bad.size) problems.push(`這些數字不在事實資料裡：${[...bad].join("、")}`);
  return problems;
}

async function summarizeWith(model: string, facts: Facts): Promise<{ out: AiOutput; usage: Usage; retried: boolean }> {
  let { out, usage } = await generate(model, facts.text);
  let problems = validate(out, facts.text);
  if (!problems.length) return { out, usage, retried: false };
  const first = usage;
  ({ out, usage } = await generate(model, facts.text, `\n\n上一次的輸出有問題：${problems.join("；")}。請修正：數字只能照抄事實資料，且不得出現操作字眼。`));
  usage = { inTokens: usage.inTokens + first.inTokens, outTokens: usage.outTokens + first.outTokens, thoughtTokens: usage.thoughtTokens + first.thoughtTokens };
  problems = validate(out, facts.text);
  if (problems.length) throw new AiError("bad_output", "這次產生的內容沒通過檢查，請稍後再試", `${model} ${problems.join("；")}`);
  return { out, usage, retried: true };
}

/** 產生解讀：先用主要模型；額度用完或模型不存在時改用備用模型。檢查沒過就丟錯（不快取、不扣次數）。 */
export async function summarize(facts: Facts): Promise<{ out: AiOutput; usage: Usage; retried: boolean; model: string }> {
  const main = aiModel(), alt = aiFallbackModel();
  try {
    return { ...(await summarizeWith(main, facts)), model: main };
  } catch (e) {
    if (!(e instanceof AiError) || !["quota", "no_model"].includes(e.code) || alt === main) throw e;
    console.warn(`[ai] ${main} ${e.code}，改用 ${alt}`);
    return { ...(await summarizeWith(alt, facts)), model: alt };
  }
}
