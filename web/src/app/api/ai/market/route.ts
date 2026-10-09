/**
 * AI 市場摘要 API（只有登入且已核准的成員能呼叫，proxy.ts 把關）。
 * GET              → 目前這一版資料的摘要（沒有就回 null，不呼叫模型）
 * GET ?facts=1     → 管理員除錯：送給 AI 的事實資料
 * POST {refresh?}  → 還沒有就產生（每次盤後資料更新只產生一次，全站共用）；管理員 refresh:true 可重新產生
 */
import { isAdmin } from "@/lib/allowlist";
import { aiEnabled, AiError, loadSnapshot } from "@/lib/server/ai";
import { buildMarketFacts, loadMarket, summarizeMarket, type MarketAi } from "@/lib/server/ai-market";
import { kvGet, kvPut } from "@/lib/server/db";
import { currentUser } from "@/lib/server/user";

export const maxDuration = 120;
const SHARED = "_ai";
const NO_STORE = { "Cache-Control": "no-store" };
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: NO_STORE });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" });

export interface MarketSummary extends MarketAi { asof: string; generatedAt: string; model: string }
interface UsageLog { n: number; inTokens: number; outTokens: number; thoughtTokens: number; retried: number; failed: number; codes: string[] }

const keyOf = (k: string) => `ai:mkt:v1:${k}` as const;

async function current() {
  const [m, snap] = await Promise.all([loadMarket(), loadSnapshot()]);
  return m && snap ? buildMarketFacts(m, snap) : null;
}

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return json({ error: "請先登入" }, 401);
  if (!aiEnabled()) return json({ enabled: false });
  const facts = await current();
  if (!facts) return json({ enabled: true, summary: null });
  if (new URL(req.url).searchParams.get("facts") === "1") {
    if (!isAdmin(u.email)) return json({ error: "只有管理員能看" }, 403);
    return new Response(`${facts.text}\n\n（${facts.text.length} 字）`, { headers: { ...NO_STORE, "content-type": "text/plain; charset=utf-8" } });
  }
  return json({ enabled: true, summary: await kvGet<MarketSummary | null>(SHARED, keyOf(facts.key), null) });
}

export async function POST(req: Request) {
  const u = await currentUser();
  if (!u) return json({ error: "請先登入" }, 401);
  if (!aiEnabled()) return json({ error: "尚未啟用 AI 摘要" }, 503);
  const refresh = ((await req.json().catch(() => ({}))) as { refresh?: unknown }).refresh === true && isAdmin(u.email);
  const facts = await current();
  if (!facts) return json({ error: "還沒有市場資料" }, 404);
  const key = keyOf(facts.key);
  const have = await kvGet<MarketSummary | null>(SHARED, key, null);
  if (have && !refresh) return json({ summary: have });

  // 避免好幾個人同時打開時重複產生：90 秒內有人在產生就請前端稍後再問
  const lockKey = `ai:mkt:lock:${facts.key}` as const;
  const lock = await kvGet<{ at: number } | null>(SHARED, lockKey, null);
  if (!refresh && lock && Date.now() - lock.at < 90_000) return json({ pending: true }, 202);
  await kvPut(SHARED, lockKey, { at: Date.now() });

  const day = today();
  const log = await kvGet<UsageLog>(SHARED, `ai:usage:${day}`, { n: 0, inTokens: 0, outTokens: 0, thoughtTokens: 0, retried: 0, failed: 0, codes: [] });
  try {
    const { out, usage, retried, model } = await summarizeMarket(facts);
    const summary: MarketSummary = { ...out, points: out.points.slice(0, 3), watch: out.watch.slice(0, 3), asof: facts.asof, generatedAt: new Date().toISOString(), model };
    await kvPut(SHARED, key, summary);
    await kvPut(SHARED, `ai:usage:${day}`, {
      n: log.n + 1, inTokens: log.inTokens + usage.inTokens, outTokens: log.outTokens + usage.outTokens,
      thoughtTokens: log.thoughtTokens + usage.thoughtTokens, retried: log.retried + (retried ? 1 : 0), failed: log.failed, codes: [...log.codes, "_market"].slice(-300),
    });
    return json({ summary });
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError("upstream", "AI 服務暫時無法使用，請稍後再試", String(e));
    console.error(`[ai] market ${err.code}：${err.detail ?? err.message}`);
    await kvPut(SHARED, lockKey, { at: 0 }).catch(() => {});
    if (err.code !== "quota") await kvPut(SHARED, `ai:usage:${day}`, { ...log, failed: log.failed + 1 }).catch(() => {});
    return json({ error: err.message, ...(isAdmin(u.email) && err.detail ? { detail: err.detail } : {}) }, err.code === "quota" ? 429 : 502);
  }
}
