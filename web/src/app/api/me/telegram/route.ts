/** Telegram 綁定：GET 回傳綁定連結；DELETE 解除綁定。 */
import { botInfo, botToken, ensureWebhook, linkCode } from "@/lib/server/telegram";
import { currentUser } from "@/lib/server/user";
import { kvGet, kvPut } from "@/lib/server/db";

export async function GET(req: Request) {
  const u = await currentUser();
  if (!u) return Response.json({ error: "請先登入" }, { status: 401 });
  if (!botToken()) return Response.json({ ready: false });
  try {
    await ensureWebhook(new URL(req.url).origin);
    const { username } = await botInfo();
    const tg = await kvGet<{ chatId?: number }>(u.hash, "telegram", {});
    return Response.json({ ready: true, linked: !!tg.chatId, bot: username, link: `https://t.me/${username}?start=${linkCode(u.hash)}` },
      { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ ready: false, error: String((e as Error).message) }, { status: 502 });
  }
}

export async function DELETE() {
  const u = await currentUser();
  if (!u) return Response.json({ error: "請先登入" }, { status: 401 });
  await kvPut(u.hash, "telegram", {});
  return Response.json({ ok: true });
}
