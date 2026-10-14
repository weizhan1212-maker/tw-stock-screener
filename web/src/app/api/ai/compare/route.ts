/**
 * 管理員用：同一份事實資料讓不同模型各寫一次，並排比較（不存檔、不影響正式摘要）。
 * GET ?kind=stock&code=6274&models=gemini-3.8-flash,gemini-3.5-flash
 * GET ?kind=market
 */
import { isAdmin } from "@/lib/allowlist";
import { AiError, buildFacts, loadSnapshot, loadStock, runWith, STOCK_SPEC } from "@/lib/server/ai";
import { buildMarketFacts, loadMarket, MARKET_SPEC } from "@/lib/server/ai-market";
import { currentUser } from "@/lib/server/user";

export const maxDuration = 300;

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u || !isAdmin(u.email)) return Response.json({ error: "只有管理員能用" }, { status: 403 });
  const q = new URL(req.url).searchParams;
  const models = (q.get("models") || "gemini-3.8-flash,gemini-3.5-flash").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 4);
  const snap = await loadSnapshot();
  if (!snap) return Response.json({ error: "沒有快照" }, { status: 500 });
  let facts: string;
  let spec: Parameters<typeof runWith>[1];
  if (q.get("kind") === "market") {
    const m = await loadMarket();
    if (!m) return Response.json({ error: "沒有市場資料" }, { status: 500 });
    facts = buildMarketFacts(m, snap).text;
    spec = MARKET_SPEC as Parameters<typeof runWith>[1];
  } else {
    const code = q.get("code") || "6274";
    const stock = await loadStock(code);
    const f = stock ? buildFacts(code, snap, stock) : null;
    if (!f) return Response.json({ error: "找不到這檔" }, { status: 404 });
    facts = f.text;
    spec = STOCK_SPEC as Parameters<typeof runWith>[1];
  }
  const results = await Promise.all(models.map(async (model) => {
    const t0 = Date.now();
    try {
      const r = await runWith(model, spec, facts);
      return { model, ms: Date.now() - t0, retried: r.retried, usage: r.usage, out: r.out };
    } catch (e) {
      return { model, ms: Date.now() - t0, error: e instanceof AiError ? `${e.code}：${e.detail ?? e.message}` : String(e) };
    }
  }));
  return Response.json({ facts_chars: facts.length, results }, { headers: { "Cache-Control": "no-store" } });
}
