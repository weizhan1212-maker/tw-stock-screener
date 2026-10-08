/**
 * 投資組合／持倉：每位使用者一份，存在 Supabase 資料庫 user_kv（key=portfolio）。
 * 手動輸入，不串券商。最多 10 個組合、每個 100 筆持倉。
 */
import { createHash } from "node:crypto";
import { auth } from "@/auth";
import { kvGet, kvPut } from "@/lib/server/db";

const hash = (email: string) => createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 32);

async function me() {
  const s = await auth();
  const u = s?.user as { email?: string; status?: string } | undefined;
  return u?.email && u.status === "approved" ? u.email : null;
}

const str = (v: unknown, max: number) => v === undefined || (typeof v === "string" && v.length <= max);
const pos = (v: unknown) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v) && v >= 0);

function validPosition(p: Record<string, unknown>) {
  return typeof p.id === "string" && p.id.length <= 40 && typeof p.code === "string" && /^[0-9A-Z]{4,6}$/.test(p.code)
    && typeof p.shares === "number" && p.shares > 0 && p.shares <= 1e9 && typeof p.cost === "number" && p.cost > 0
    && typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date)
    && str(p.reason, 500) && str(p.horizon, 10) && str(p.note, 500) && pos(p.target) && pos(p.stop);
}

function valid(body: unknown): body is { portfolios: unknown[] } {
  const b = body as { portfolios?: unknown };
  if (!b || !Array.isArray(b.portfolios) || b.portfolios.length > 10) return false;
  return b.portfolios.every((x) => {
    const p = x as { id?: unknown; name?: unknown; positions?: unknown };
    return typeof p.id === "string" && typeof p.name === "string" && p.name.length > 0 && p.name.length <= 30
      && Array.isArray(p.positions) && p.positions.length <= 100 && p.positions.every((q) => validPosition(q as Record<string, unknown>));
  });
}

export async function GET() {
  const email = await me();
  if (!email) return Response.json({ error: "請先登入" }, { status: 401 });
  const data = await kvGet<{ portfolios: unknown[] }>(hash(email), "portfolio", { portfolios: [] });
  return Response.json({ portfolios: data.portfolios ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const email = await me();
  if (!email) return Response.json({ error: "請先登入" }, { status: 401 });
  const body = await req.json().catch(() => null);
  if (!valid(body)) return Response.json({ error: "格式錯誤" }, { status: 400 });
  await kvPut(hash(email), "portfolio", { portfolios: body.portfolios, updated_at: new Date().toISOString() });
  return Response.json({ ok: true });
}
