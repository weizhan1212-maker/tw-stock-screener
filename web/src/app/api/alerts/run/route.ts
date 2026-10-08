/**
 * 每日警報評估：由 GitHub Actions 在篩選快照更新後呼叫（Authorization: Bearer <由伺服器金鑰衍生的密鑰>）。
 * 同一個資料日只評估一次（傍晚場、夜間場不會重複通知）。
 */
import { timingSafeEqual } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { type Alert, type AlertConfig, type AlertStateFile, type EventsFile, evaluate, evaluateNotice, type Note, type PortfolioPos } from "@/lib/alerts";
import { decode, type RawSnapshot } from "@/lib/screener";
import { botToken, sendMessage } from "@/lib/server/telegram";
import { derivedSecret, userPath } from "@/lib/server/user";
import { getJson, getObject, putJson } from "@/lib/storage";

export const maxDuration = 60;
const SITE = "https://tw-stock-screener-willy1212.vercel.app";

export async function POST(req: Request) {
  const want = derivedSecret("alerts-run");
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!want || got.length !== want.length || !timingSafeEqual(Buffer.from(got), Buffer.from(want))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const res = await getObject("site/snapshot.json.gz");
  if (!res) return Response.json({ error: "沒有快照" }, { status: 404 });
  const buf = Buffer.from(await res.arrayBuffer());
  const raw = JSON.parse((buf[0] === 0x1f ? gunzipSync(buf) : buf).toString("utf8")) as RawSnapshot;
  const snap = decode(raw);
  const meta = snap.meta as unknown as { asof: string; market_bull?: boolean };
  let events: EventsFile = { asof: meta.asof, recent: [], conf: [] };
  try {
    const er = await getObject("site/events.json.gz");
    if (er) {
      const eb = Buffer.from(await er.arrayBuffer());
      events = JSON.parse((eb[0] === 0x1f ? gunzipSync(eb) : eb).toString("utf8")) as EventsFile;
    }
  } catch { /* 沒有重大訊息檔就略過 notice 警報 */ }
  const idx = await getJson<{ users: string[] }>("alerts/users.json", { users: [] });
  const tgOn = !!botToken();
  const summary = { users: 0, notes: 0, telegram: 0, errors: 0 };

  for (const h of idx.users) {
    try {
      const [cfg, st, tg] = await Promise.all([
        getJson<AlertConfig>(userPath(h, "alerts.json"), { alerts: [] }),
        getJson<AlertStateFile>(userPath(h, "alert_state.json"), { state: {}, inbox: [] }),
        getJson<{ chatId?: number }>(userPath(h, "telegram.json"), {}),
      ]);
      const active = cfg.alerts.filter((a: Alert) => a.enabled);
      if (!active.length) continue;
      summary.users++;
      let positions: PortfolioPos[] = [];
      if (active.some((a) => a.kind === "portfolio")) {
        const pf = await getJson<{ portfolios: { positions: PortfolioPos[] }[] }>(userPath(h, "portfolio.json"), { portfolios: [] });
        positions = pf.portfolios.flatMap((p) => p.positions);
      }
      const noticeScopes = new Set(active.filter((a) => a.kind === "notice").map((a) => a.scope ?? "watchlist"));
      const scopeCodes: Record<string, string[]> = {};
      if (noticeScopes.has("watchlist")) scopeCodes.watchlist = (await getJson<{ codes: string[] }>(userPath(h, "watchlist.json"), { codes: [] })).codes ?? [];
      if (noticeScopes.has("portfolio")) {
        const pf = await getJson<{ portfolios: { positions: PortfolioPos[] }[] }>(userPath(h, "portfolio.json"), { portfolios: [] });
        scopeCodes.portfolio = [...new Set(pf.portfolios.flatMap((p) => p.positions.map((x) => x.code)))];
      }
      const state = { ...(st.state ?? {}) };
      const fresh: Note[] = [];
      const tgLines: string[] = [];
      for (const a of active) {
        if (state[a.id]?.asof === meta.asof) continue;                 // 這個資料日已評估過
        const r = a.kind === "notice"
          ? evaluateNotice(a, events, scopeCodes[a.scope ?? "watchlist"] ?? [], state[a.id], meta.asof)
          : evaluate(a, snap.rows, meta, state[a.id], positions);
        state[a.id] = r.state;
        if (r.note) {
          fresh.push({ ...r.note, t: new Date().toISOString(), asof: meta.asof, alertId: a.id });
          if (a.telegram) tgLines.push(`🔔 ${r.note.title}\n${r.note.body}${r.note.link ? `\n${SITE}${r.note.link}` : ""}`);
        }
      }
      for (const k of Object.keys(state)) if (!cfg.alerts.some((a) => a.id === k)) delete state[k];   // 已刪除的警報
      const inbox = [...fresh, ...(st.inbox ?? [])].slice(0, 100);
      await putJson(userPath(h, "alert_state.json"), { state, inbox });
      summary.notes += fresh.length;
      if (tgOn && tg.chatId && tgLines.length) {
        await sendMessage(tg.chatId, `股見未來 ${meta.asof} 盤後警報\n\n${tgLines.join("\n\n")}`);
        summary.telegram++;
      }
    } catch {
      summary.errors++;
    }
  }
  return Response.json({ asof: meta.asof, ...summary });
}
