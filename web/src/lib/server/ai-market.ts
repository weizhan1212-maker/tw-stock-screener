/**
 * AI 市場摘要（伺服器端）：每次盤後資料更新後產生一次，全站共用。
 * 事實資料由伺服器從 market.json 與篩選快照整理（大盤、廣度、法人、融資券、情緒、資金輪動），
 * 模型負責歸納今天的市場氣氛與資金輪動；只描述今天，不預測、不給買賣建議。
 */
import "server-only";
import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { breadthNotes, computeBreadth } from "@/lib/breadth";
import { computeRotation, splitFlow, type GroupStat } from "@/lib/rotation";
import type { Snapshot } from "@/lib/screener";
import { getCachedBytes } from "@/lib/storage";
import { runAi, textProblems, type AiSpec } from "@/lib/server/ai";

interface Card { label: string; name?: string; date: string; close: number | null; chg: number | null; chg_pct: number | null; spark?: (number | null)[] }
export interface MarketData {
  asof: string;
  indices: Card[];
  breadth?: Record<"all" | "TWSE" | "TPEX", { up: number; flat: number; down: number }>;
  turnover?: { value: number; value_ratio: number | null };
  insti?: { date: string; foreign: number; trust: number; dealer: number; total: number; markets: string[]; series: { date: string; total: number | null }[] };
  margin?: { date: string; margin_amount: number; margin_amount_prev: number; short_lots: number; short_lots_prev: number };
  daytrade?: { date: string; TWSE?: number; TPEX?: number };
  industry_flow?: { days: number; items: { industry: string; amount: number | null }[] };
  sentiment?: {
    fear_greed?: { score: number; label: string };
    pcr?: { date: string; oi: number | null };
    fut_insti?: { date: string; foreign_oi_net: number | null };
    fx?: { date: string; usd_twd: number | null; chg20: number | null };
  };
}

export async function loadMarket(): Promise<MarketData | null> {
  const file = process.env.MARKET_FILE;
  let buf: Buffer | null = null;
  if (file && !process.env.VERCEL) buf = await readFile(file);
  else { const b = await getCachedBytes("site/market.json.gz", 300_000); buf = b ? Buffer.from(b) : null; }
  if (!buf) return null;
  return JSON.parse((buf[0] === 0x1f ? gunzipSync(buf) : buf).toString("utf8")) as MarketData;
}

const f2 = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const sg = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${f2(v)}`);
const yi = (v: number | null | undefined) => (v == null ? "—" : `${sg(v / 1e8)} 億`);
const md = (d: string) => d.replaceAll("-", "/");

function groupLine(g: GroupStat) {
  const lead = g.leaders.map((s) => `${s.name}（${s.code}）${sg(s.chg)}%`).join("、");
  return `${g.name}（${g.n} 檔）：今日漲跌中位數 ${sg(g.chg)}%｜5 日中位數 ${sg(g.ret5)}%｜20 日中位數 ${sg(g.ret20)}%｜成交占比 ${f2(g.share)}%（20 日平均 ${f2(g.share20)}%，為平常的 ${f2(g.heat)} 倍）｜上漲家數比例 ${f2(g.upRatio)}%`
    + `${g.inst5 != null ? `｜法人 5 日買賣超 ${sg(g.inst5)} 億` : ""}｜今天漲幅前幾名：${lead}`;
}

export interface MarketFacts { asof: string; key: string; text: string }

export function buildMarketFacts(m: MarketData, snap: Snapshot): MarketFacts {
  const out: string[] = [`資料日：${md(m.asof)}（篩選快照資料日 ${md(snap.meta.asof)}）`];

  out.push("\n【指數】");
  for (const c of m.indices) out.push(`${c.label}：${f2(c.close)}，漲跌 ${sg(c.chg)}（${sg(c.chg_pct)}%）${c.date !== m.asof ? `（資料日 ${md(c.date)}）` : ""}`);
  // 加權指數近幾日收盤與每日漲跌幅，讓「比前幾天」有根據
  const tw = m.indices.find((c) => c.label.includes("加權"));
  const sp = (tw?.spark ?? []).filter((v): v is number => v != null).slice(-6);
  if (sp.length >= 3) {
    const moves = sp.slice(1).map((v, i) => `${sg(((v / sp[i]) - 1) * 100)}%`);
    out.push(`加權指數近 ${sp.length - 1} 個交易日每日漲跌幅（舊到新）：${moves.join("、")}`);
  }

  const b = m.breadth;
  if (b) out.push("\n【漲跌家數】", ...(["all", "TWSE", "TPEX"] as const).map((k) => `${{ all: "全部", TWSE: "上市", TPEX: "上櫃" }[k]}：上漲 ${b[k].up} 家、平盤 ${b[k].flat} 家、下跌 ${b[k].down} 家`));

  if (m.turnover) out.push("\n【成交值】", `股票＋ETF 成交值 ${f2(m.turnover.value / 1e8)} 億，為 20 日平均的 ${f2(m.turnover.value_ratio)} 倍`);
  if (m.daytrade) out.push(`當沖占比：上市 ${f2(m.daytrade.TWSE)}%${m.daytrade.TPEX != null ? `、上櫃 ${f2(m.daytrade.TPEX)}%` : ""}`);

  const ins = m.insti;
  if (ins) {
    out.push(`\n【三大法人（${ins.markets.length === 2 ? "上市＋上櫃" : "上市"}，${md(ins.date)}）】`, `合計 ${yi(ins.total)}；外資 ${yi(ins.foreign)}、投信 ${yi(ins.trust)}、自營商 ${yi(ins.dealer)}`);
    const last5 = ins.series.slice(-5).map((x) => `${md(x.date)} ${yi(x.total)}`);
    if (last5.length) out.push(`近 5 個交易日合計買賣超：${last5.join("；")}`);
  }
  if (m.margin) {
    const mm = m.margin;
    out.push(`\n【融資融券（上市，${md(mm.date)}）】`, `融資餘額 ${f2(mm.margin_amount / 1e8)} 億（較前一日 ${yi(mm.margin_amount - mm.margin_amount_prev)}）`, `融券餘額 ${mm.short_lots.toLocaleString("en-US")} 張（較前一日 ${sg(mm.short_lots - mm.short_lots_prev).replace(".00", "")} 張）`);
  }

  // 市場結構（普通股）
  const br = computeBreadth(snap.rows, "all");
  const idx = m.indices.find((c) => c.label.includes("加權"));
  out.push(`\n【市場結構（上市＋上櫃普通股 ${br.n} 檔）】`,
    `上漲家數比例 ${f2(br.upRatio)}%；站上 20 日線 ${f2(br.above20)}%、站上 60 日線 ${f2(br.above60)}%、站上 240 日線 ${f2(br.above240)}%`,
    `創 20 日新高 ${br.newHigh20} 檔；創 52 週新高 ${br.newHigh52} 檔、新低 ${br.newLow52} 檔；漲停約 ${br.limitUp} 檔、跌停約 ${br.limitDown} 檔`,
    ...breadthNotes(br, idx?.chg_pct ?? null, m.turnover?.value_ratio).map((n) => `判讀：${n.text}`));

  const se = m.sentiment;
  if (se) {
    const ls: string[] = [];
    if (se.fear_greed) ls.push(`恐懼貪婪指數 ${f2(se.fear_greed.score)}（${se.fear_greed.label}）`);
    if (se.pcr?.oi != null) ls.push(`選擇權 Put/Call 未平倉比 ${f2(se.pcr.oi)}%（${md(se.pcr.date)}）`);
    if (se.fut_insti?.foreign_oi_net != null) ls.push(`外資台指期未平倉淨額 ${se.fut_insti.foreign_oi_net.toLocaleString("en-US")} 口（${md(se.fut_insti.date)}）`);
    if (se.fx?.usd_twd != null) ls.push(`美元兌新台幣 ${f2(se.fx.usd_twd)}，20 日變化 ${sg(se.fx.chg20)}%（${md(se.fx.date)}）`);
    if (ls.length) out.push("\n【市場情緒】", ...ls);
  }

  // 資金輪動
  const rot = computeRotation(snap.rows);
  for (const [title, list] of [["題材", rot.themes], ["產業", rot.industries]] as const) {
    const { inflow, outflow } = splitFlow(list, 5);
    out.push(`\n【資金輪動－${title}：資金流入（成交占比高於平常且今天中位數上漲，依倍數排序）】`, ...(inflow.length ? inflow.map(groupLine) : ["無"]));
    out.push(`【資金輪動－${title}：資金退潮（成交占比低於平常或今天明顯下跌）】`, ...(outflow.length ? outflow.map(groupLine) : ["無"]));
  }
  const flow = m.industry_flow?.items ?? [];
  if (flow.length) {
    const top = [...flow].filter((x) => (x.amount ?? 0) > 0).reverse().slice(0, 5).map((x) => `${x.industry} ${yi(x.amount)}`);
    const bot = flow.filter((x) => (x.amount ?? 0) < 0).slice(0, 5).map((x) => `${x.industry} ${yi(x.amount)}`);
    out.push(`\n【三大法人近 ${m.industry_flow!.days} 日產業資金（估算）】`, `買超：${top.join("、") || "無"}`, `賣超：${bot.join("、") || "無"}`);
  }

  // 快取鍵：市場資料日＋快照產生時間（每次盤後更新換一版）；只留英數，避免網址編碼問題
  return { asof: m.asof, key: `${m.asof}_${String(snap.meta.generated_at ?? "").replace(/[^0-9A-Za-z]/g, "")}`, text: out.join("\n") };
}

// ---------------- AI 規格 ----------------

export interface MarketPoint { title: string; text: string }
export interface MarketAi { tone: string; headline: string; summary: string; points: MarketPoint[]; rotation: string; watch: string[] }

const SYSTEM = `你是資深台股盤後分析師，替一般散戶寫「今日市場摘要」。讀者看得到原始數字，你的價值在於歸納：今天大盤的真實狀況（指數和多數股票是否一致）、法人與散戶籌碼、資金往哪些題材與產業流動。
規則：
1. 數字只能來自事實資料並原樣照抄（含小數與單位），不得自己計算、換算或四捨五入。只有 watch 可以用整數門檻。
2. 不得出現任何操作字眼：買進、賣出、加碼、減碼、進場、出場、停損、停利、目標價、推薦、看好、看壞；不要預測明天或之後的漲跌，不寫「支撐」「轉機」「上漲空間」「後市」這類暗示後市的說法，也不寫「避險」「避風」「防禦」這類推測資金動機的字。
3. 「連續」「持續」「創高」這類趨勢詞，只能在資料直接看得出來時使用；要和「前幾天」比較，只能用有提供前幾天數字的項目（加權指數每日漲跌幅、法人近 5 日）。不得推測原因或資料裡沒有的事（新聞、政策、國際情勢、財報內容、資金「避險」或「撤出台股」等動機）；只說資金流向哪裡，不說為什麼。
4. tone：只能是「偏多」「中性」「偏空」其中之一，描述「今天」的市場氣氛（綜合指數、漲跌家數、法人方向），不是預測。
5. headline：一句話（40 字內）點出今天最重要的事。
6. summary：80～130 字，把大盤、廣度、籌碼串成一段；指數與多數股票方向不一致時要點出來。
7. points：3 點，title 依序為「大盤與廣度」「籌碼動向」「情緒與風險」，每點 text 50～100 字，每點都要有比較對象（平常、前一日、近 5 日）並說明代表什麼。
8. rotation：100～180 字，說明資金輪動：哪些題材／產業資金流入、哪些退潮，點名 2～4 個題材並舉代表股（照抄事實資料的名稱與漲跌幅）；題材與產業都要看，說明是少數題材獨強還是普遍輪動。
9. watch：接下來值得留意的 3 件事，每件 30 字內，具體寫出指標。
10. 台灣慣用的繁體中文白話；必要術語用括號簡短解釋。
只輸出 JSON。`;

const POINT = { type: "OBJECT", properties: { title: { type: "STRING" }, text: { type: "STRING" } }, required: ["title", "text"] };
const SCHEMA = {
  type: "OBJECT",
  properties: {
    tone: { type: "STRING", enum: ["偏多", "中性", "偏空"] },
    headline: { type: "STRING" },
    summary: { type: "STRING" },
    points: { type: "ARRAY", items: POINT },
    rotation: { type: "STRING" },
    watch: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["tone", "headline", "summary", "points", "rotation", "watch"],
};

function validate(o: MarketAi, factsText: string): string[] {
  if (!o || !["偏多", "中性", "偏空"].includes(o.tone) || typeof o.headline !== "string" || typeof o.summary !== "string" || typeof o.rotation !== "string"
    || !Array.isArray(o.points) || !o.points.length || !o.points.every((p) => p && typeof p.title === "string" && typeof p.text === "string")
    || !Array.isArray(o.watch) || !o.watch.every((w) => typeof w === "string")) return ["結構不完整"];
  const strict = [o.headline, o.summary, o.rotation, ...o.points.flatMap((p) => [p.title, p.text])];
  const probs = textProblems(strict, o.watch, factsText);
  const guess = strict.map((t) => t.match(/避險|避風|撤出台股|資金外逃|恐慌性|防禦性轉向/)?.[0]).filter(Boolean);
  if (guess.length) probs.push(`出現資料無法佐證的動機推測：${[...new Set(guess)].join("、")}（只說資金流向哪裡，不說原因）`);
  return probs;
}

/** 市場摘要指定用 3.8 Flash（Willy 指定）；額度用完才改用共用模型清單。 */
const SPEC: AiSpec<MarketAi> = { system: SYSTEM, schema: SCHEMA, validate, models: [process.env.GEMINI_MARKET_MODEL || "gemini-3.8-flash"] };

export const summarizeMarket = (facts: MarketFacts) => runAi(SPEC, facts.text);
