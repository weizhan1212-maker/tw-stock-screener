/**
 * 每日警報評估：由 GitHub Actions 在篩選快照更新後呼叫（Authorization: Bearer <由伺服器金鑰衍生的密鑰>）。
 * - 傍晚場（融資融券、外資持股還沒到）先評估一次，盤後第一時間通知。
 * - 夜間場籌碼到齊（meta.complete）後，同一資料日再用完整資料評估一次，只推送新增的結果。
 * - 同一資料日、同樣完整度不重複評估。Telegram 送不出去時保留，下次一起補送。
 */
import { timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { type Alert, type AlertConfig, type AlertStateFile, type EventsFile, evaluate, evaluateNotice, type Note, type PortfolioPos } from "@/lib/alerts";
import { decode, type RawSnapshot } from "@/lib/screener";
import { botToken, sendMessage } from "@/lib/server/telegram";
import { alertUsers, kvGet, kvPut } from "@/lib/server/db";
import { derivedSecret } from "@/lib/server/user";
import { getObject } from "@/lib/storage";

export const maxDuration = 60;
const SITE = "https://tw-stock-screener-willy1212.vercel.app";
const PARALLEL = 5;

async function gz<T>(path: string): Promise<T | null> {
  const res = await getObject(path);
  if (!res) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  return JSON.parse((buf[0] === 0x1f ? gunzipSync(buf) : buf).toString("utf8")) as T;
}

export async function POST(req: Request) {
  const want = derivedSecret("alerts-run");
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const raw = await gz<RawSnapshot>("site/snapshot.json.gz");
  if (!raw) return Response.json({ error: "沒有快照" }, { status: 404 });
  const snap = decode(raw);
  const meta = snap.meta as unknown as { asof: string; market_bull?: boolean; complete?: boolean };
  const full = meta.complete !== false;             // 舊快照沒有這個欄位時視為完整
  let events: EventsFile = { asof: meta.asof, recent: [], conf: [] };
  try { events = (await gz<EventsFile>("site/events.json.gz")) ?? events; } catch { /* 沒有就略過 notice 警報 */ }
  const idxUsers = await alertUsers();
  const tgOn = !!botToken();
  const summary = { asof: meta.asof, full, users: 0, notes: 0, telegram: 0, tgFailed: 0, errors: 0 };

  async function runUser(h: string) {
    const [cfg, st, tg] = await Promise.all([
      kvGet<AlertConfig>(h, "alerts", { alerts: [] }),
      kvGet<AlertStateFile>(h, "alert_state", { state: {}, inbox: [] }),
      kvGet<{ chatId?: number }>(h, "telegram", {}),
    ]);
    const active = cfg.alerts.filter((a: Alert) => a.enabled);
    if (!active.length && !st.tgPending?.length) return;
    summary.users++;
    const needPf = active.some((a) => a.kind === "portfolio" || (a.kind === "notice" && a.scope === "portfolio"));
    const pf = needPf ? await kvGet<{ portfolios: { positions: PortfolioPos[] }[] }>(h, "portfolio", { portfolios: [] }) : { portfolios: [] };
    const positions = pf.portfolios.flatMap((p) => p.positions);
    const scopeCodes: Record<string, string[]> = { portfolio: [...new Set(positions.map((x) => x.code))] };
    if (active.some((a) => a.kind === "notice" && (a.scope ?? "watchlist") === "watchlist")) {
      scopeCodes.watchlist = (await kvGet<{ codes: string[] }>(h, "watchlist", { codes: [] })).codes ?? [];
    }
    const state = { ...(st.state ?? {}) };
    const fresh: Note[] = [];
    const tgLines: string[] = [];
    for (const a of active) {
      const prev = state[a.id];
      if (prev?.asof === meta.asof && (prev.full || !full)) continue;     // 這個資料日、這個完整度已評估過
      const r = a.kind === "notice"
        ? evaluateNotice(a, events, scopeCodes[a.scope ?? "watchlist"] ?? [], prev, meta.asof)
        : evaluate(a, snap.rows, meta, prev, positions);
      state[a.id] = { ...r.state, full };
      if (r.note) {
        fresh.push({ ...r.note, t: new Date().toISOString(), asof: meta.asof, alertId: a.id });
        if (a.telegram) tgLines.push(`🔔 ${r.note.title}\n${r.note.body}${r.note.link ? `\n${SITE}${r.note.link}` : ""}`);
      }
    }
    for (const k of Object.keys(state)) if (!cfg.alerts.some((a) => a.id === k)) delete state[k];   // 已刪除的警報
    // Telegram：先送（含上次沒送成功的），失敗就留著下次補送
    let pending = [...(st.tgPending ?? []), ...tgLines].slice(-20);
    if (tgOn && tg.chatId && pending.length) {
      try {
        await sendMessage(tg.chatId, `股見未來 ${meta.asof} 盤後警報\n\n${pending.join("\n\n")}`);
        summary.telegram++;
        pending = [];
      } catch {
        summary.tgFailed++;
      }
    } else if (!tg.chatId) {
      pending = [];                                  // 沒綁 Telegram 就不留
    }
    await kvPut(h, "alert_state", { state, inbox: [...fresh, ...(st.inbox ?? [])].slice(0, 100), tgPending: pending });
    summary.notes += fresh.length;
  }

  const users = [...idxUsers];
  await Promise.all(Array.from({ length: Math.min(PARALLEL, users.length) }, async () => {
    for (let h = users.shift(); h; h = users.shift()) {
      try { await runUser(h); } catch { summary.errors++; }
    }
  }));
  return Response.json(summary, { status: summary.errors ? 500 : 200 });
}
