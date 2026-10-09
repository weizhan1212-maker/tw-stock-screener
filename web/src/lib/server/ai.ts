/**
 * AI 個股摘要（伺服器端）：
 * - 事實資料由伺服器自己從快照與個股檔算好（不採用瀏覽器傳來的內容，因為結果會共用給所有人）。
 * - 模型只負責把事實寫成平實的文字；數字一律照抄，輸出後逐一檢查，檢查不過就不給。
 * - 只描述事實，不給買賣建議（含目標價、進出場、停損停利）。
 * 金鑰：環境變數 GEMINI_API_KEY（Google AI Studio）；模型：GEMINI_MODEL（預設 gemini-3.1-flash-lite）。
 */
import "server-only";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { FIELD_MAP, FIELDS } from "@/lib/fields";
import { decode, fmtUnit, num, type RawSnapshot, type Row, type Snapshot } from "@/lib/screener";
import { focusTags, grade, industryRank, outlooks, type StockFile } from "@/lib/stock";
import { getCachedBytes } from "@/lib/storage";

export const aiEnabled = () => !!process.env.GEMINI_API_KEY;
export const aiModel = () => process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";

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

// ---------------- 事實資料 ----------------

const SECTIONS: { title: string; keys: string[] }[] = [
  { title: "價量", keys: ["close", "chg_pct", "volume_lots", "value", "vol_ratio", "market_cap"] },
  { title: "技術面", keys: ["ret5", "ret20", "ret60", "ret120", "ret240", "rs20", "rs60", "dist_high52", "dist_low52", "dist_ma240", "above_ma20", "above_ma60", "above_ma240", "bull_align", "k", "d", "rsi14", "macd_hist", "atr_pct"] },
  { title: "估值", keys: ["pe", "pb", "dividend_yield", "psr"] },
  { title: "基本面", keys: ["eps_ttm", "rev_yoy", "rev_yoy_min3", "rev_yoy_chg", "roe", "f_score", "health_score", "div_years"] },
];

const line = (r: Row, key: string, signed = false) => {
  const f = FIELD_MAP[key];
  const v = r[key];
  if (!f || v == null) return null;
  return `${f.label}：${fmtUnit(v, f.format, signed)}`;
};

export interface Facts { code: string; name: string; asof: string; text: string }

/** 把一檔股票整理成給模型看的事實清單；找不到資料回傳 null。 */
export function buildFacts(code: string, snap: Snapshot, s: StockFile): Facts | null {
  const row = snap.rows.find((r) => r.code === code);
  if (!row) return null;
  const name = String(row.name ?? s.info?.name ?? code);
  const out: string[] = [`股票：${name}（${code}）　市場：${s.info?.market ?? "—"}　產業：${row.ind ?? s.info?.industry ?? "—"}`, `價量與估值資料日：${snap.meta.asof}`];
  const signedKeys = new Set(["chg_pct", "ret5", "ret20", "ret60", "ret120", "ret240", "rs20", "rs60", "dist_high52", "dist_low52", "dist_ma240", "rev_yoy", "rev_yoy_chg", "rev_yoy_min3"]);

  for (const sec of SECTIONS) {
    const ls = sec.keys.map((k) => line(row, k, signedKeys.has(k))).filter(Boolean) as string[];
    if (sec.title === "基本面" && num(row.health_score) != null) ls.push(`財務健康評級：${grade(num(row.health_score))}`);
    if (sec.title === "基本面") {
      const rk = industryRank(snap.rows, code);
      if (rk) ls.push(`財務健康度同產業排名：第 ${rk.rank} 名／共 ${rk.total} 檔`);
    }
    if (sec.title === "技術面") for (const o of outlooks(row)) if (o.state !== "資料不足") ls.push(`${o.label}（${o.span}）狀態：${o.state}`);
    if (ls.length) out.push(`\n【${sec.title}】`, ...ls);
  }

  // 籌碼：快照裡所有籌碼面欄位（有值的）
  const chips = FIELDS.filter((f) => f.group === "籌碼面").map((f) => line(row, f.key, /net|_chg/.test(f.key))).filter(Boolean) as string[];
  const margin = snap.meta.margin_asof && snap.meta.margin_asof < snap.meta.asof ? `（融資融券與外資持股資料到 ${snap.meta.margin_asof}，比價格晚一天）` : "";
  if (chips.length) out.push(`\n【籌碼面】${margin}`, ...chips);
  const tags = focusTags(snap.rows, code).slice(0, 6).map((t) => `${t.label}第 ${t.rank} 名`);
  if (tags.length) out.push(`\n【全市場排名】`, tags.join("、"));

  // 月營收年增率（用同月比；單位不一，只給比率）
  const rev = s.revenue ?? [];
  const yoy: string[] = [];
  for (const [m, v] of rev.slice(-6)) {
    const prevKey = `${Number(m.slice(0, 4)) - 1}${m.slice(4)}`;
    const p = rev.find(([k]) => k === prevKey)?.[1];
    if (v != null && p != null && p > 0) yoy.push(`${m}：${(((v / p) - 1) * 100).toFixed(2)}%`);
  }
  if (yoy.length) out.push(`\n【近月營收年增率】`, yoy.join("；"));

  // 近 4 季財報
  const qs = (s.quarters ?? []).slice(-4).map((q) => {
    const parts = [q.eps != null ? `EPS ${q.eps.toFixed(2)} 元` : null, q.gm != null ? `毛利率 ${q.gm.toFixed(2)}%` : null, q.om != null ? `營益率 ${q.om.toFixed(2)}%` : null, q.nm != null ? `淨利率 ${q.nm.toFixed(2)}%` : null].filter(Boolean);
    return parts.length ? `${q.p}：${parts.join("，")}` : null;
  }).filter(Boolean);
  if (qs.length) out.push(`\n【近 4 季財報】`, ...(qs as string[]));

  // 公告與法說會
  const ev = s.events;
  const recent = (ev?.recent ?? []).slice(0, 4).map((e) => `${e.d} ${e.s.replace(/\s+/g, " ").slice(0, 60)}`);
  const conf = (ev?.conf ?? []).filter((c) => c.d >= snap.meta.asof).slice(0, 2).map((c) => `${c.d}${c.t ? ` ${c.t}` : ""} 法說會`);
  if (recent.length || conf.length) out.push(`\n【近期公告與事件】`, ...recent, ...conf);

  return { code, name, asof: snap.meta.asof, text: out.join("\n") };
}

// ---------------- 呼叫模型 ----------------

export interface AiSection { key: string; title: string; text: string }
export interface AiOutput { headline: string; sections: AiSection[]; overall: string }
export interface Usage { inTokens: number; outTokens: number; thoughtTokens: number }

const SYSTEM = `你是台股資料整理助手。請根據使用者提供的「事實資料」，寫一份中性、平實的個股摘要。
規則：
1. 只能使用事實資料裡出現的資訊與數字；數字一律原樣照抄（含小數與單位），不得四捨五入、換算、自己計算或推估。
2. 只描述現況與變化。不得預測股價，也不得出現任何買賣建議、評分、目標價、進出場、加碼減碼、停損停利的字眼。
3. 事實資料沒提供或標示「—」的項目視為資料不足，直接略過，不要猜測。
4. 使用台灣慣用的繁體中文，語氣平實，句子簡短。
5. sections 只放有資料可說的面向，key 只能是 tech（技術面）、valuation（估值與獲利）、revenue（營收與財報）、chips（籌碼）、events（公告與事件）；每段 text 約 60～110 字。
6. headline 一句話（30 字內）點出最值得注意的事實；overall 約 80～120 字，把各面向的事實串成一段，不做結論性的買賣判斷。
只輸出 JSON：{"headline":"","sections":[{"key":"","title":"","text":""}],"overall":""}`;

const SCHEMA = {
  type: "OBJECT",
  properties: {
    headline: { type: "STRING" },
    sections: { type: "ARRAY", items: { type: "OBJECT", properties: { key: { type: "STRING" }, title: { type: "STRING" }, text: { type: "STRING" } }, required: ["key", "title", "text"] } },
    overall: { type: "STRING" },
  },
  required: ["headline", "sections", "overall"],
};

/** 從寬到嚴的參數組合：模型或參數不被接受（400）時自動換下一組，並記住這次成功的那組。 */
const LEVELS = ["full", "no-thinking", "json-only"] as const;
let level = 0;

export class AiError extends Error {
  constructor(public code: "no_key" | "quota" | "bad_output" | "upstream", message: string, public detail?: string) { super(message); }
}

async function callOnce(factsText: string, extra: string, lv: (typeof LEVELS)[number]) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new AiError("no_key", "尚未啟用 AI 摘要");
  const gen: Record<string, unknown> = { temperature: 0.2, maxOutputTokens: 2500, responseMimeType: "application/json" };
  if (lv === "full") { gen.responseSchema = SCHEMA; gen.thinkingConfig = { thinkingLevel: "low" }; }
  if (lv === "no-thinking") gen.responseSchema = SCHEMA;
  const base = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/$/, "");   // 只有測試時會改
  const res = await fetch(`${base}/v1beta/models/${aiModel()}:generateContent`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(45_000),
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

async function generate(factsText: string, extra = ""): Promise<{ out: AiOutput; usage: Usage }> {
  let r = await callOnce(factsText, extra, LEVELS[level]);
  while (r.status === 400 && level < LEVELS.length - 1) {
    console.warn(`[ai] 400（${LEVELS[level]}）：${r.body.slice(0, 300)}`);
    level++;
    r = await callOnce(factsText, extra, LEVELS[level]);
  }
  if (r.status === 429) throw new AiError("quota", "Google 的免費額度暫時用完了，請稍後再試", r.body.slice(0, 300));
  if (r.status !== 200) {
    console.error(`[ai] ${r.status}：${r.body.slice(0, 400)}`);
    throw new AiError("upstream", "AI 服務暫時無法使用，請稍後再試", `${r.status} ${r.body.slice(0, 300)}`);
  }
  const j = JSON.parse(r.body) as GeminiResp;
  const text = (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  let out: AiOutput;
  try { out = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")) as AiOutput; }
  catch { throw new AiError("bad_output", "AI 回覆的格式不對，請再試一次", `finish=${j.candidates?.[0]?.finishReason} ${text.slice(0, 200)}`); }
  const u = j.usageMetadata ?? {};
  return { out, usage: { inTokens: u.promptTokenCount ?? 0, outTokens: u.candidatesTokenCount ?? 0, thoughtTokens: u.thoughtsTokenCount ?? 0 } };
}

// ---------------- 輸出檢查 ----------------

const BANNED = /(建議(?:買|賣|進|出|加|減|持|布局|投資人|停|您|大家)|買進|賣出|買入|加碼|減碼|進場|出場|停損|停利|目標價|值得買|不要買|可以買|應該買|推薦|看好|看壞|看漲|看跌|必漲|必跌|穩賺|保證|轉強可期|有望|預期將|預計將|可望)/;

/** 檢查：結構完整、沒有買賣建議字眼、文字裡的數字都出現在事實資料中。回傳問題清單（空＝通過）。 */
export function validate(o: AiOutput, factsText: string): string[] {
  const problems: string[] = [];
  if (!o || typeof o.headline !== "string" || typeof o.overall !== "string" || !Array.isArray(o.sections) || !o.sections.length) return ["結構不完整"];
  const all = [o.headline, o.overall, ...o.sections.flatMap((s) => [s.title ?? "", s.text ?? ""])];
  const hit = all.map((t) => t.match(BANNED)?.[0]).filter(Boolean);
  if (hit.length) problems.push(`出現不允許的字眼：${[...new Set(hit)].join("、")}`);
  const pool = factsText.replace(/,/g, "");
  const bad = new Set<string>();
  for (const t of all) {
    for (const m of t.replace(/,/g, "").matchAll(/-?\d+(?:\.\d+)?/g)) {
      const n = m[0].replace(/^-/, "");
      if (/^\d{1,2}$/.test(n)) continue;                 // 「5 日」「20 日線」這類期間、順位的小整數不查
      if (!pool.includes(n)) bad.add(m[0]);
    }
  }
  if (bad.size) problems.push(`這些數字不在事實資料裡：${[...bad].join("、")}`);
  return problems;
}

/** 產生摘要；檢查沒過就把問題告訴模型重寫一次，仍沒過就丟錯（不快取、不扣次數）。 */
export async function summarize(facts: Facts): Promise<{ out: AiOutput; usage: Usage; retried: boolean }> {
  let { out, usage } = await generate(facts.text);
  let problems = validate(out, facts.text);
  if (!problems.length) return { out, usage, retried: false };
  const first = usage;
  ({ out, usage } = await generate(facts.text, `\n\n上一次的輸出有問題：${problems.join("；")}。請修正：數字只能照抄事實資料，且不得出現買賣建議的字眼。`));
  usage = { inTokens: usage.inTokens + first.inTokens, outTokens: usage.outTokens + first.outTokens, thoughtTokens: usage.thoughtTokens + first.thoughtTokens };
  problems = validate(out, facts.text);
  if (problems.length) throw new AiError("bad_output", "這次產生的內容沒通過檢查，請稍後再試", problems.join("；"));
  return { out, usage, retried: true };
}
