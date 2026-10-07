/**
 * Telegram 伺服器呼叫的 webhook（不需登入；用 secret_token 標頭驗證來源）。
 * /start <代碼> → 綁定；/stop → 解除綁定。
 */
import { timingSafeEqual } from "node:crypto";
import { botToken, sendMessage, verifyCode, webhookSecret } from "@/lib/server/telegram";
import { userPath } from "@/lib/server/user";
import { getJson, putJson } from "@/lib/storage";

const INDEX = "alerts/users.json";

export async function POST(req: Request) {
  if (!botToken()) return new Response("not configured", { status: 404 });
  const got = Buffer.from(req.headers.get("x-telegram-bot-api-secret-token") ?? "");
  const want = Buffer.from(webhookSecret());
  if (got.length !== want.length || !timingSafeEqual(got, want)) return new Response("forbidden", { status: 403 });
  const upd = (await req.json().catch(() => null)) as { message?: { chat?: { id?: number; type?: string }; text?: string } } | null;
  const chatId = upd?.message?.chat?.id, text = (upd?.message?.text ?? "").trim();
  if (!chatId || upd?.message?.chat?.type !== "private") return Response.json({ ok: true });
  try {
    const m = /^\/start(?:\s+(\S+))?$/.exec(text);
    if (m) {
      const hash = m[1] ? verifyCode(m[1]) : null;
      if (!hash) {
        await sendMessage(chatId, "請到「股見未來」網站的「警報」頁按「連結 Telegram」，從那個連結進來才能完成綁定。");
      } else {
        await putJson(userPath(hash, "telegram.json"), { chatId, linkedAt: new Date().toISOString() });
        const idx = await getJson<{ users: string[] }>(INDEX, { users: [] });
        if (!idx.users.includes(hash)) await putJson(INDEX, { users: [...idx.users, hash] });
        await sendMessage(chatId, "✅ 已綁定「股見未來」。之後你設定的警報會在每天盤後傳到這裡。\n要停止通知，傳 /stop 或到網站解除綁定。");
      }
    } else if (text === "/stop") {
      await sendMessage(chatId, "要停止通知，請到網站「警報」頁按「解除綁定」，或把各警報的 Telegram 通知關掉。");
    } else {
      await sendMessage(chatId, "這個機器人只負責傳送「股見未來」的警報通知，不會回覆訊息。");
    }
  } catch {
    // 回 200，避免 Telegram 一直重送
  }
  return Response.json({ ok: true });
}
