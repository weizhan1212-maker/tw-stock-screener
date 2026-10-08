/**
 * 已儲存的篩選組合：每位使用者一份（條件、股票池、欄位、排序），最多 30 組。
 * 存在 Supabase 資料庫 user_kv（key=screens）。
 */
import { createHash } from "node:crypto";
import { auth } from "@/auth";
import { kvGet, kvPut } from "@/lib/server/db";

const MAX = 30;
const hash = (email: string) => createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 32);

async function me() {
  const s = await auth();
  const u = s?.user as { email?: string; status?: string } | undefined;
  return u?.email && u.status === "approved" ? u.email : null;
}

interface Screen { name: string; query: string; cols: string[] | null }

function valid(x: unknown): x is Screen {
  const s = x as Screen;
  return !!s && typeof s.name === "string" && s.name.length > 0 && s.name.length <= 40
    && typeof s.query === "string" && s.query.length <= 2000
    && (s.cols === null || (Array.isArray(s.cols) && s.cols.length <= 40 && s.cols.every((c) => typeof c === "string" && /^[a-z0-9_]{1,40}$/.test(c))));
}

export async function GET() {
  const email = await me();
  if (!email) return Response.json({ error: "請先登入" }, { status: 401 });
  const data = await kvGet<{ screens: Screen[] }>(hash(email), "screens", { screens: [] });
  return Response.json({ screens: data.screens ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const email = await me();
  if (!email) return Response.json({ error: "請先登入" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { screens?: unknown } | null;
  const list = Array.isArray(body?.screens) ? body!.screens : null;
  if (!list || !list.every(valid)) return Response.json({ error: "格式錯誤" }, { status: 400 });
  const screens = (list as Screen[]).slice(0, MAX);
  await kvPut(hash(email), "screens", { screens, updated_at: new Date().toISOString() });
  return Response.json({ screens });
}
