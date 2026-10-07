/**
 * Telegram 機器人：綁定使用者、送通知。
 * 需要環境變數 TELEGRAM_BOT_TOKEN（Willy 自己貼到 Vercel 與 GitHub Secrets）。
 * 綁定流程：網站產生 t.me/<bot>?start=<代碼> 連結 → 使用者按「開始」→ Telegram 呼叫我們的 webhook → 存下 chat_id。
 * 代碼＝使用者雜湊＋HMAC 簽章，不必另外存暫存資料；webhook 用由 token 衍生的 secret_token 驗證來源。
 */
import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const API = "https://api.telegram.org";
export const botToken = () => process.env.TELEGRAM_BOT_TOKEN?.trim() || null;

const sig = (h: string) => createHmac("sha256", `tg-link:${botToken()}`).update(h).digest("hex").slice(0, 20);
export const webhookSecret = () => createHash("sha256").update(`tg-hook:${botToken()}`).digest("hex").slice(0, 48);

export const linkCode = (hash: string) => `${hash}_${sig(hash)}`;
export function verifyCode(code: string): string | null {
  const m = /^([0-9a-f]{32})_([0-9a-f]{20})$/.exec(code);
  if (!m) return null;
  const a = Buffer.from(sig(m[1])), b = Buffer.from(m[2]);
  return a.length === b.length && timingSafeEqual(a, b) ? m[1] : null;
}

async function call<T>(method: string, body?: unknown): Promise<T> {
  const t = botToken();
  if (!t) throw new Error("尚未設定 TELEGRAM_BOT_TOKEN");
  const r = await fetch(`${API}/bot${t}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), cache: "no-store",
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`Telegram ${method}：${j.description ?? r.status}`);
  return j.result as T;
}

let me: Promise<{ username: string }> | null = null;
export const botInfo = () => (me ??= call<{ username: string }>("getMe").catch((e) => { me = null; throw e; }));

/** 確認 webhook 指到這個網站（每個伺服器執行個體只檢查一次） */
let hooked: Promise<void> | null = null;
export function ensureWebhook(origin: string) {
  return (hooked ??= (async () => {
    const url = `${origin}/api/telegram/webhook`;
    const info = await call<{ url: string }>("getWebhookInfo");
    if (info.url !== url) await call("setWebhook", { url, secret_token: webhookSecret(), allowed_updates: ["message"] });
  })().catch((e) => { hooked = null; throw e; }));
}

export function sendMessage(chatId: number, text: string) {
  return call("sendMessage", { chat_id: chatId, text: text.slice(0, 4000), disable_web_page_preview: true });
}
