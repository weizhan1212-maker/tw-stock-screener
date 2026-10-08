/**
 * 我的警報：GET 取得設定、通知收件匣、Telegram 綁定狀態；PUT 覆寫設定（含「已讀到哪裡」）。
 * 設定在資料庫 user_kv key=alerts（使用者寫）；收件匣與狀態 key=alert_state（每日任務寫）；有設警報的人記在 alert_users。
 */
import { type Alert, type AlertConfig, type AlertStateFile, MAX_ALERTS } from "@/lib/alerts";
import { currentUser } from "@/lib/server/user";
import { alertUserAdd, kvGet, kvPut } from "@/lib/server/db";


function validAlert(a: Alert) {
  const s = (v: unknown, n: number) => typeof v === "string" && v.length <= n;
  if (!s(a.id, 40) || !s(a.name, 40) || typeof a.enabled !== "boolean" || typeof a.telegram !== "boolean") return false;
  switch (a.kind) {
    case "price": return s(a.code, 6) && /^[0-9A-Z]{4,6}$/.test(a.code!) && s(a.field, 30) && (a.op === "ge" || a.op === "le") && typeof a.value === "number" && Number.isFinite(a.value);
    case "screen": return s(a.query, 2000);
    case "strategy": return s(a.strategyId, 40) && (a.params === undefined || (typeof a.params === "object" && Object.values(a.params).every((v) => typeof v === "number")));
    case "portfolio": return true;
    case "notice": return a.scope === "watchlist" || a.scope === "portfolio";
    default: return false;
  }
}

export async function GET() {
  const u = await currentUser();
  if (!u) return Response.json({ error: "請先登入" }, { status: 401 });
  const [cfg, st, tg] = await Promise.all([
    kvGet<AlertConfig>(u.hash, "alerts", { alerts: [] }),
    kvGet<AlertStateFile>(u.hash, "alert_state", { state: {}, inbox: [] }),
    kvGet<{ chatId?: number }>(u.hash, "telegram", {}),
  ]);
  return Response.json({ ...cfg, inbox: st.inbox ?? [], state: st.state ?? {}, telegram: !!tg.chatId, telegramReady: !!process.env.TELEGRAM_BOT_TOKEN },
    { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const u = await currentUser();
  if (!u) return Response.json({ error: "請先登入" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as AlertConfig | null;
  if (!b || !Array.isArray(b.alerts) || b.alerts.length > MAX_ALERTS || !b.alerts.every(validAlert)
    || (b.lastRead !== undefined && typeof b.lastRead !== "string")) {
    return Response.json({ error: "格式錯誤" }, { status: 400 });
  }
  await kvPut(u.hash, "alerts", { alerts: b.alerts, lastRead: b.lastRead, updated_at: new Date().toISOString() });
  // 每日任務只檢查有設定警報的使用者
  if (b.alerts.length) await alertUserAdd(u.hash);
  return Response.json({ ok: true });
}
