/**
 * 自選股：每位使用者一份，存在 Supabase Storage users/{email 雜湊}/watchlist.json。
 * GET 取得、PUT 整份覆寫（最多 300 檔）。
 */
import { createHash } from "node:crypto";
import { auth } from "@/auth";
import { getJson, putJson } from "@/lib/storage";

const MAX = 300;
const path = (email: string) => `users/${createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 32)}/watchlist.json`;

async function me() {
  const s = await auth();
  const u = s?.user as { email?: string; status?: string } | undefined;
  return u?.email && u.status === "approved" ? u.email : null;
}

export async function GET() {
  const email = await me();
  if (!email) return Response.json({ error: "請先登入" }, { status: 401 });
  const data = await getJson<{ codes: string[] }>(path(email), { codes: [] });
  return Response.json({ codes: data.codes ?? [] }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const email = await me();
  if (!email) return Response.json({ error: "請先登入" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { codes?: unknown } | null;
  const codes = Array.isArray(body?.codes) ? body!.codes : null;
  if (!codes || !codes.every((c) => typeof c === "string" && /^[0-9A-Z]{4,6}$/.test(c))) {
    return Response.json({ error: "格式錯誤" }, { status: 400 });
  }
  const uniq = [...new Set(codes as string[])].slice(0, MAX);
  await putJson(path(email), { codes: uniq, updated_at: new Date().toISOString() });
  return Response.json({ codes: uniq });
}
