/**
 * 警報：設定格式（瀏覽器與伺服器共用）與每日評估邏輯（伺服器端每天盤後跑一次）。
 * - price：個股條件（收盤價、漲跌幅、量比…）從「不成立」變「成立」時通知一次
 * - screen：我的篩選組合，有新股票符合時通知
 * - strategy：預設策略，有新股票入選時通知（策略每日通知）
 * - portfolio：投資組合持股到達目標價或跌破失效價時通知一次
 * - notice：自選股或持股有新的重大訊息、法說會快到了時通知（來源 site/events.json.gz）
 */
import { decodeConds, funnel, inUniverse, type Market, num, type Row, type Universe } from "./screener";
import { defaults, makeCtx, type Params, STRATEGY_MAP } from "./strategies";
import { FIELD_MAP } from "./fields";

export type AlertKind = "price" | "screen" | "strategy" | "portfolio" | "notice";
export interface Alert {
  id: string;
  kind: AlertKind;
  name: string;
  enabled: boolean;
  telegram: boolean;
  code?: string; field?: string; op?: "ge" | "le"; value?: number;   // price
  query?: string;                                                     // screen（自訂篩選網址參數）
  strategyId?: string; params?: Params;                               // strategy
  scope?: "watchlist" | "portfolio";                                  // notice：看哪一組股票
}
export interface AlertConfig { alerts: Alert[]; lastRead?: string }
export interface Note { t: string; asof: string; alertId: string; title: string; body: string; link?: string }
export interface AlertState { asof?: string; full?: boolean; on?: boolean; codes?: string[]; seen?: string[]; pos?: Record<string, { target?: boolean; stop?: boolean }> }
export interface AlertStateFile { state: Record<string, AlertState>; inbox: Note[]; tgPending?: string[] }

export interface EventsFile {
  asof: string;
  recent: { code: string; name: string; d: string; t: string; s: string; c: number | null }[];
  conf: { code: string; name: string; d: string; t: string | null }[];
}
export const CONF_DAYS = 3;     // 法說會前幾天開始提醒

/** 重大訊息警報：自選股／持股有新公告，或法說會在 CONF_DAYS 天內。已通知過的不重複。 */
export function evaluateNotice(a: Alert, ev: EventsFile, codes: string[], prev: AlertState | undefined, asof: string):
  { state: AlertState; note?: Omit<Note, "t" | "asof" | "alertId"> } {
  const set = new Set(codes);
  const lim = new Date(Date.parse(asof) + CONF_DAYS * 86400000).toISOString().slice(0, 10);
  const items: { key: string; line: string; code: string }[] = [];
  for (const e of ev.recent) if (set.has(e.code)) items.push({ key: `n:${e.code}:${e.d}:${e.t}:${e.s.slice(0, 24)}`, code: e.code, line: `${e.code} ${e.name}　${e.d} ${e.t}\n${e.s}` });
  for (const c of ev.conf) if (set.has(c.code) && c.d >= asof && c.d <= lim) items.push({ key: `c:${c.code}:${c.d}`, code: c.code, line: `${c.code} ${c.name}　法說會 ${c.d}${c.t ? ` ${c.t}` : ""}` });
  const link = a.scope === "portfolio" ? "/portfolio" : "/watchlist";
  const keys = items.map((i) => i.key);
  if (!prev?.seen) {
    return { state: { asof, seen: keys.slice(0, 400) },
      note: { title: `${a.name}：開始追蹤`, body: `看${a.scope === "portfolio" ? "投資組合持股" : "自選股"}（${codes.length} 檔），之後有新的重大訊息或法說會快到了會通知你。`, link } };
  }
  const seen = new Set(prev.seen);
  const fresh = items.filter((i) => !seen.has(i.key));
  const next = [...new Set([...keys, ...prev.seen])].slice(0, 400);
  if (!fresh.length) return { state: { asof, seen: next } };
  const shown = fresh.slice(0, 10).map((i) => i.line).join("\n\n");
  const first = fresh[0].code;
  return {
    state: { asof, seen: next },
    note: { title: `${a.name}：${fresh.length} 則重大訊息／法說會`, body: `${shown}${fresh.length > 10 ? `\n…還有 ${fresh.length - 10} 則` : ""}`, link: fresh.length === 1 ? `/stock/${first}#notices` : link },
  };
}

export const PRICE_FIELDS = ["close", "chg_pct", "vol_ratio", "rsi14", "dist_high52", "pe", "dividend_yield", "foreign_buy_streak"];
export const MAX_ALERTS = 30;

export interface PortfolioPos { id: string; code: string; target?: number | null; stop?: number | null }

/** 評估一個警報；回傳新狀態與要送出的通知（可能沒有）。 */
export function evaluate(a: Alert, rows: Row[], meta: { asof: string; market_bull?: boolean }, prev: AlertState | undefined,
  positions: PortfolioPos[] = []): { state: AlertState; note?: Omit<Note, "t" | "asof" | "alertId"> } {
  const by = new Map(rows.map((r) => [r.code as string, r]));
  const nm = (c: string) => `${c} ${(by.get(c)?.name as string) ?? ""}`.trim();
  if (a.kind === "price") {
    const r = by.get(a.code ?? "");
    const v = num(r?.[a.field ?? "close"]);
    const on = v != null && a.value != null && (a.op === "le" ? v <= a.value : v >= a.value);
    const f = FIELD_MAP[a.field ?? "close"];
    const fire = on && prev?.on !== true;          // 剛變成成立（新建立時已成立也通知一次）
    return {
      state: { asof: meta.asof, on },
      note: fire ? { title: `${nm(a.code!)}：${f?.label ?? a.field} ${a.op === "le" ? "≤" : "≥"} ${a.value}`, body: `目前 ${v}`, link: `/stock/${a.code}` } : undefined,
    };
  }
  if (a.kind === "portfolio") {
    const pos: AlertState["pos"] = {};
    const hits: string[] = [];
    for (const p of positions) {
      const c = num(by.get(p.code)?.close);
      const t = c != null && !!p.target && c >= p.target, s = c != null && !!p.stop && c <= p.stop;
      const old = prev?.pos?.[p.id];
      if (t && !old?.target) hits.push(`${nm(p.code)} 收盤 ${c}，到達目標價 ${p.target}`);
      if (s && !old?.stop) hits.push(`${nm(p.code)} 收盤 ${c}，跌破失效價 ${p.stop}`);
      pos[p.id] = { target: t, stop: s };
    }
    return { state: { asof: meta.asof, pos }, note: hits.length ? { title: `持倉提醒（${hits.length} 筆）`, body: hits.join("\n"), link: "/portfolio" } : undefined };
  }
  let codes: string[] = [];
  let link = "/";
  if (a.kind === "screen") {
    const q = new URLSearchParams(a.query ?? "");
    const u = q.get("u"), m = q.get("m");
    const pool = rows.filter((r) => inUniverse(r, (u === "stock" || u === "etf" ? u : "all") as Universe, (m === "TWSE" || m === "TPEX" ? m : "all") as Market));
    codes = funnel(pool, decodeConds(q.get("c"))).result.map((r) => r.code as string);
    link = `/screener?${a.query ?? ""}`;
  } else if (a.kind === "strategy") {
    const s = STRATEGY_MAP[a.strategyId ?? ""];
    if (!s) return { state: { asof: meta.asof } };
    codes = s.run(makeCtx(rows, meta.market_bull), { ...defaults(s), ...(a.params ?? {}) }).map((r) => r.code as string);
    link = `/strategy/${s.id}`;
  }
  const before = new Set(prev?.codes ?? []);
  const added = prev?.codes ? codes.filter((c) => !before.has(c)) : [];
  const removed = prev?.codes ? (prev.codes.filter((c) => !codes.includes(c))) : [];
  let note;
  if (!prev?.codes) note = { title: `${a.name}：開始追蹤`, body: `目前符合 ${codes.length} 檔，之後有新股票符合時會通知你。`, link };
  else if (added.length) {
    note = {
      title: `${a.name}：新增 ${added.length} 檔`,
      body: `${added.slice(0, 15).map(nm).join("、")}${added.length > 15 ? ` 等 ${added.length} 檔` : ""}\n目前共 ${codes.length} 檔${removed.length ? `，移出 ${removed.length} 檔` : ""}`,
      link,
    };
  }
  return { state: { asof: meta.asof, codes }, note };
}

export function describe(a: Alert): string {
  if (a.kind === "price") return `${a.code}　${FIELD_MAP[a.field ?? "close"]?.label ?? a.field} ${a.op === "le" ? "≤" : "≥"} ${a.value}`;
  if (a.kind === "screen") return `自訂篩選組合有新股票符合時通知`;
  if (a.kind === "strategy") return `「${STRATEGY_MAP[a.strategyId ?? ""]?.name ?? a.strategyId}」有新股票入選時通知`;
  if (a.kind === "notice") return `${a.scope === "portfolio" ? "投資組合持股" : "自選股"}有新的重大訊息，或法說會 ${CONF_DAYS} 天內舉行時通知`;
  return "投資組合持股到達目標價或跌破失效價時通知";
}
