/**
 * AI 個股解讀 API（只有登入且已核准的成員能呼叫，proxy.ts 把關）。
 * GET  ?code=2330&asof=2026-10-09 → 是否啟用、有沒有現成的摘要、今天用了幾次（不呼叫模型）
 * GET  ?usage=1（僅管理員）        → 近 7 天模型用量，用來估費用
 * GET  ?facts=2330（僅管理員）      → 送給 AI 的事實資料（不呼叫模型）
 * POST {code, refresh?}            → 有現成的就直接給（不扣次數；管理員 refresh:true 可重新產生）；沒有才呼叫模型，每人每天、全站每天各有上限
 * 同一檔同一個資料日只產生一次，結果存在 user_kv（user_hash="_ai"），所有人共用。
 */
import { isAdmin } from "@/lib/allowlist";
import { AiError, aiEnabled, aiModel, buildFacts, loadSnapshot, loadStock, summarize, type AiOutput, type Factor } from "@/lib/server/ai";
import { kvGet, kvPut } from "@/lib/server/db";
import { currentUser } from "@/lib/server/user";

export const maxDuration = 120;                           // 最多重寫兩次，加上備用模型，預留時間
const SHARED = "_ai";
const USER_LIMIT = Number(process.env.AI_USER_LIMIT) || 10;
const ADMIN_LIMIT = 999;                                  // 管理員測試用，不受每人上限（全站上限照舊）
const limitFor = (email: string | null | undefined) => (isAdmin(email) ? ADMIN_LIMIT : USER_LIMIT);
const DAY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 200;
const NO_STORE = { "Cache-Control": "no-store" };

export interface AiSummary extends AiOutput { v: 2; code: string; name: string; asof: string; generatedAt: string; model: string; factors: Factor[] }
/** 快取鍵（v2：解讀版；舊的 ai:sum:* 是描述版，不再使用） */
const sumKey = (code: string, asof: string) => `ai:v2:${code}:${asof}` as const;
interface Counter { n: number }
interface UsageLog { n: number; inTokens: number; outTokens: number; thoughtTokens: number; retried: number; failed: number; codes: string[] }

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
const okCode = (c: unknown): c is string => typeof c === "string" && /^[0-9A-Z]{4,6}$/.test(c);
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: NO_STORE });

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return json({ error: "請先登入" }, 401);
  const q = new URL(req.url).searchParams;
  if (q.get("usage") === "1") {
    if (!isAdmin(u.email)) return json({ error: "只有管理員能看" }, 403);
    const days: Record<string, UsageLog | null> = {};
    for (let i = 0; i < 7; i++) {
      const d = new Date(Date.now() - i * 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });
      days[d] = await kvGet<UsageLog | null>(SHARED, `ai:usage:${d}`, null);
    }
    return json({ model: aiModel(), userLimit: USER_LIMIT, dayLimit: DAY_LIMIT, days });
  }
  const fc = q.get("facts");
  if (fc) {                                            // 管理員除錯：看送給 AI 的事實資料（不呼叫模型）
    if (!isAdmin(u.email)) return json({ error: "只有管理員能看" }, 403);
    if (!okCode(fc)) return json({ error: "代號格式不對" }, 400);
    const [snap, stock] = await Promise.all([loadSnapshot(), loadStock(fc)]);
    const f = snap && stock ? buildFacts(fc, snap, stock) : null;
    return f ? new Response(`${f.text}\n\n${JSON.stringify(f.factors)}\n（${f.text.length} 字）`, { headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } }) : json({ error: "找不到資料" }, 404);
  }
  if (!aiEnabled()) return json({ enabled: false });
  const code = q.get("code"), asof = q.get("asof");
  let cached: AiSummary | null = null;
  if (okCode(code) && asof && /^\d{4}-\d{2}-\d{2}$/.test(asof)) cached = await kvGet<AiSummary | null>(SHARED, sumKey(code, asof), null);
  const used = (await kvGet<Counter>(u.hash, `ai:quota:${today()}`, { n: 0 })).n;
  return json({ enabled: true, cached, used, limit: limitFor(u.email) });
}

export async function POST(req: Request) {
  const u = await currentUser();
  if (!u) return json({ error: "請先登入" }, 401);
  if (!aiEnabled()) return json({ error: "尚未啟用 AI 摘要" }, 503);
  const body = (await req.json().catch(() => ({}))) as { code?: unknown; refresh?: unknown };
  const code = body.code;
  const refresh = body.refresh === true && isAdmin(u.email);   // 管理員調整指令後重新產生用
  if (!okCode(code)) return json({ error: "代號格式不對" }, 400);

  const snap = await loadSnapshot();
  if (!snap) return json({ error: "還沒有篩選快照" }, 404);
  const asof = snap.meta.asof;
  const day = today();
  const mine = await kvGet<Counter>(u.hash, `ai:quota:${day}`, { n: 0 });

  const have = await kvGet<AiSummary | null>(SHARED, sumKey(code, asof), null);
  const limit = limitFor(u.email);
  if (have && !refresh) return json({ summary: have, cached: true, used: mine.n, limit });

  if (mine.n >= limit) return json({ error: `今天的 AI 摘要次數用完了（每人每天 ${USER_LIMIT} 次）。已產生過的摘要仍可直接查看。` }, 429);
  const log = await kvGet<UsageLog>(SHARED, `ai:usage:${day}`, { n: 0, inTokens: 0, outTokens: 0, thoughtTokens: 0, retried: 0, failed: 0, codes: [] });
  if (log.n >= DAY_LIMIT) return json({ error: "今天全站的 AI 額度用完了，明天再來。已產生過的摘要仍可直接查看。" }, 429);

  const stock = await loadStock(code);
  if (!stock) return json({ error: "找不到這檔股票的資料" }, 404);
  if (stock.info?.sec_type === "etf") return json({ error: "ETF 目前不提供 AI 摘要" }, 400);
  const facts = buildFacts(code, snap, stock);
  if (!facts) return json({ error: "快照裡沒有這檔股票" }, 404);

  try {
    const r = await summarize(facts);
    const { out, usage, retried, model } = r;
    const summary: AiSummary = {
      v: 2, code, name: facts.name, asof, generatedAt: new Date().toISOString(), model, factors: facts.factors,
      positioning: out.positioning, headline: out.headline, bulls: out.bulls.slice(0, 3), risks: out.risks.slice(0, 3), change: out.change, watch: out.watch.slice(0, 3),
    };
    await kvPut(SHARED, sumKey(code, asof), summary);
    await kvPut(u.hash, `ai:quota:${day}`, { n: mine.n + 1 });
    await kvPut(SHARED, `ai:usage:${day}`, {
      n: log.n + 1, inTokens: log.inTokens + usage.inTokens, outTokens: log.outTokens + usage.outTokens,
      thoughtTokens: log.thoughtTokens + usage.thoughtTokens, retried: log.retried + (retried ? 1 : 0), failed: log.failed, codes: [...log.codes, code].slice(-300),
    });
    return json({ summary, cached: false, used: mine.n + 1, limit });
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("upstream", "AI 服務暫時無法使用，請稍後再試", String(e));
    console.error(`[ai] ${code} ${err.code}：${err.detail ?? err.message}`);
    if (err.code !== "quota") await kvPut(SHARED, `ai:usage:${day}`, { ...log, failed: log.failed + 1 }).catch(() => {});
    // 細節只給管理員（排查用），一般成員只看到白話說明；失敗不扣次數
    return json({ error: err.message, ...(isAdmin(u.email) && err.detail ? { detail: err.detail } : {}) }, err.code === "quota" ? 429 : 502);
  }
}
