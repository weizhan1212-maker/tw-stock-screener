"use client";

/** 警報頁：Telegram 綁定、通知收件匣、警報清單與新增。每天盤後評估一次。 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { NumInput } from "@/components/Screener";
import { useSnapshot } from "@/hooks/useSnapshot";
import { type Alert, type AlertKind, describe, MAX_ALERTS, type Note, PRICE_FIELDS } from "@/lib/alerts";
import { FIELD_MAP } from "@/lib/fields";
import { STRATEGIES, STRATEGY_MAP } from "@/lib/strategies";

const uid = () => Math.random().toString(36).slice(2, 10);
interface Data { alerts: Alert[]; lastRead?: string; inbox: Note[]; telegram: boolean; telegramReady: boolean }
interface Tg { ready: boolean; linked?: boolean; bot?: string; link?: string; error?: string }

export default function Alerts() {
  const q = useSearchParams();
  const [data, setData] = useState<Data | null>(null);
  const [tg, setTg] = useState<Tg | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    fetch("/api/me/alerts").then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
    }).catch((e) => setMsg(`讀取失敗：${e.message}`));
    fetch("/api/me/telegram").then((r) => r.json()).then(setTg).catch(() => setTg({ ready: false }));
  }, []);
  useEffect(() => { document.title = "警報｜股見未來"; load(); }, [load]);

  async function save(next: Partial<Data>) {
    if (!data) return;
    const merged = { ...data, ...next };
    setData(merged);
    const r = await fetch("/api/me/alerts", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ alerts: merged.alerts, lastRead: merged.lastRead }) });
    setMsg(r.ok ? "" : `儲存失敗：HTTP ${r.status}`);
  }

  const unread = data ? data.inbox.filter((n) => !data.lastRead || n.t > data.lastRead).length : 0;

  return (
    <div className="mx-auto max-w-[1100px] px-4 py-5">
      <h1 className="text-xl font-bold text-ink">警報</h1>
      <p className="mt-1 text-sm text-muted">每個交易日盤後（約 18:45）檢查一次，符合時通知在這一頁；綁定 Telegram 後也會傳到手機。</p>
      {msg && <p className="mt-2 rounded-lg bg-warn-bg px-3 py-2 text-sm text-warn-ink">{msg}</p>}

      <TelegramCard tg={tg} onUnlink={async () => { await fetch("/api/me/telegram", { method: "DELETE" }); load(); }} onRefresh={load} />

      {data && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <section className="rounded-lg border border-line bg-surface p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-ink">通知{unread > 0 && <span className="ml-2 rounded-full bg-up px-2 py-0.5 text-xs text-white">{unread} 則未讀</span>}</h2>
                {unread > 0 && <button type="button" onClick={() => save({ lastRead: new Date().toISOString() })} className="text-xs text-accent hover:underline">全部標為已讀</button>}
              </div>
              {data.inbox.length === 0 ? <p className="mt-2 text-sm text-muted">還沒有通知。</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {data.inbox.slice(0, 50).map((n, i) => {
                    const isNew = !data.lastRead || n.t > data.lastRead;
                    return (
                      <li key={i} className="py-2 text-sm">
                        <div className="flex flex-wrap items-baseline gap-x-2">
                          {isNew && <span className="h-2 w-2 rounded-full bg-up" aria-label="未讀" />}
                          {n.link ? <Link href={n.link} className="font-medium text-ink hover:text-accent">{n.title}</Link> : <span className="font-medium text-ink">{n.title}</span>}
                          <span className="num ml-auto text-xs text-muted">{n.asof}</span>
                        </div>
                        <p className="mt-0.5 whitespace-pre-line text-xs leading-relaxed text-muted">{n.body}</p>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section className="rounded-lg border border-line bg-surface p-4">
              <h2 className="text-base font-bold text-ink">我的警報 <span className="text-sm font-normal text-muted">{data.alerts.length}/{MAX_ALERTS}</span></h2>
              {data.alerts.length === 0 ? <p className="mt-2 text-sm text-muted">還沒有警報，用右邊新增。</p> : (
                <ul className="mt-2 divide-y divide-line">
                  {data.alerts.map((a) => (
                    <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                      <span className={`min-w-0 flex-1 ${a.enabled ? "text-ink" : "text-muted line-through"}`}>
                        <b>{a.name}</b><span className="ml-2 text-xs text-muted">{describe(a)}</span>
                      </span>
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input type="checkbox" checked={a.enabled} onChange={(e) => save({ alerts: data.alerts.map((x) => (x.id === a.id ? { ...x, enabled: e.target.checked } : x)) })} />啟用
                      </label>
                      <label className="flex items-center gap-1 text-xs text-muted">
                        <input type="checkbox" checked={a.telegram} onChange={(e) => save({ alerts: data.alerts.map((x) => (x.id === a.id ? { ...x, telegram: e.target.checked } : x)) })} />Telegram
                      </label>
                      <button type="button" onClick={() => save({ alerts: data.alerts.filter((x) => x.id !== a.id) })} className="text-xs text-muted hover:text-up">刪除</button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {data.alerts.length < MAX_ALERTS && (
            <AddForm key={q.toString()} q={q} hasPortfolio={data.alerts.some((a) => a.kind === "portfolio")}
              onAdd={(a) => save({ alerts: [...data.alerts, a] })} />
          )}
        </div>
      )}
    </div>
  );
}

function TelegramCard({ tg, onUnlink, onRefresh }: { tg: Tg | null; onUnlink: () => void; onRefresh: () => void }) {
  return (
    <section className="mt-4 rounded-lg border border-line bg-surface p-4 text-sm text-ink">
      <h2 className="text-base font-bold">Telegram 通知</h2>
      {!tg ? <p className="mt-1 text-muted">檢查中…</p>
        : !tg.ready ? <p className="mt-1 text-muted">{tg.error ? `暫時連不上 Telegram：${tg.error}` : "管理員還沒設定 Telegram 機器人，目前只會在這一頁通知。"}</p>
        : tg.linked ? (
          <p className="mt-1">✅ 已綁定（@{tg.bot}）。<button type="button" onClick={onUnlink} className="ml-2 text-xs text-muted underline hover:text-up">解除綁定</button></p>
        ) : (
          <div className="mt-1 space-y-2">
            <p>按下面的按鈕會打開 Telegram，在機器人對話裡按「開始」就完成綁定。</p>
            <div className="flex flex-wrap gap-2">
              <a href={tg.link} target="_blank" rel="noreferrer" className="rounded-md bg-accent px-3 py-1.5 font-bold text-white">連結 Telegram</a>
              <button type="button" onClick={onRefresh} className="rounded-md border border-line px-3 py-1.5">我已按了開始，重新檢查</button>
            </div>
          </div>
        )}
    </section>
  );
}

function AddForm({ q, hasPortfolio, onAdd }: { q: URLSearchParams; hasPortfolio: boolean; onAdd: (a: Alert) => void }) {
  const { snap } = useSnapshot();
  const init: AlertKind = q.get("strategy") ? "strategy" : q.get("screen") ? "screen" : "price";
  const [kind, setKind] = useState<AlertKind>(init);
  const [code, setCode] = useState(q.get("code") ?? "");
  const [field, setField] = useState("close");
  const [op, setOp] = useState<"ge" | "le">("ge");
  const [value, setValue] = useState<number | undefined>(undefined);
  const [strategyId, setStrategyId] = useState(q.get("strategy") ?? STRATEGIES[0].id);
  const [screens, setScreens] = useState<{ name: string; query: string }[] | null>(null);
  const [screen, setScreen] = useState(q.get("screen") ?? "");
  const [telegram, setTelegram] = useState(true);
  useEffect(() => {
    fetch("/api/me/screens").then((r) => r.json()).then((j) => setScreens(j.screens ?? [])).catch(() => setScreens([]));
  }, []);
  const c = code.trim().toUpperCase();
  const row = snap?.rows.find((r) => r.code === c);
  const input = "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";

  let alert: Alert | null = null;
  if (kind === "price" && row && value != null) {
    alert = { id: uid(), kind, name: `${c} ${row.name}`.slice(0, 40), enabled: true, telegram, code: c, field, op, value };
  } else if (kind === "strategy" && STRATEGY_MAP[strategyId]) {
    alert = { id: uid(), kind, name: STRATEGY_MAP[strategyId].name.slice(0, 40), enabled: true, telegram, strategyId };
  } else if (kind === "screen" && screen) {
    const s = screens?.find((x) => x.query === screen);
    alert = { id: uid(), kind, name: (s?.name ?? "自訂篩選").slice(0, 40), enabled: true, telegram, query: screen };
  } else if (kind === "portfolio" && !hasPortfolio) {
    alert = { id: uid(), kind, name: "持倉提醒", enabled: true, telegram };
  }

  return (
    <form className="self-start rounded-lg border border-line bg-surface p-4 text-sm text-ink" onSubmit={(e) => { e.preventDefault(); if (alert) onAdd(alert); }}>
      <h2 className="font-bold">新增警報</h2>
      <label className="mt-3 flex flex-col gap-1 text-xs text-muted">種類
        <select value={kind} onChange={(e) => setKind(e.target.value as AlertKind)} className={input}>
          <option value="price">個股條件（例如收盤價突破）</option>
          <option value="strategy">策略有新股票入選</option>
          <option value="screen">我的篩選組合有新股票符合</option>
          <option value="portfolio">投資組合到目標價／失效價</option>
        </select>
      </label>
      {kind === "price" && (
        <div className="mt-2 space-y-2">
          <label className="flex flex-col gap-1 text-xs text-muted">代號
            <input value={code} onChange={(e) => setCode(e.target.value)} className={input} placeholder="例如 2330" />
            <span className={row ? "text-ink" : ""}>{c ? (row ? `${row.name}　收盤 ${row.close}` : "找不到這個代號") : ""}</span>
          </label>
          <div className="flex items-end gap-2">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted">指標
              <select value={field} onChange={(e) => setField(e.target.value)} className={input}>
                {PRICE_FIELDS.map((k) => <option key={k} value={k}>{FIELD_MAP[k]?.label ?? k}</option>)}
              </select>
            </label>
            <select value={op} onChange={(e) => setOp(e.target.value as "ge" | "le")} aria-label="比較方式" className="rounded-md border border-line bg-surface px-1.5 py-1.5">
              <option value="ge">≥</option><option value="le">≤</option>
            </select>
            <NumInput value={value} onChange={setValue} label="數值" />
          </div>
          <p className="text-xs text-muted">條件從「不成立」變「成立」時通知一次，不會每天重複。</p>
        </div>
      )}
      {kind === "strategy" && (
        <label className="mt-2 flex flex-col gap-1 text-xs text-muted">策略（用預設數字）
          <select value={strategyId} onChange={(e) => setStrategyId(e.target.value)} className={input}>
            {(["基本策略", "大師策略", "單一條件"] as const).map((g) => (
              <optgroup key={g} label={g}>{STRATEGIES.filter((s) => s.group === g).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</optgroup>
            ))}
          </select>
        </label>
      )}
      {kind === "screen" && (
        <label className="mt-2 flex flex-col gap-1 text-xs text-muted">篩選組合
          {screens && screens.length === 0 ? <span>還沒有儲存的篩選組合，先到 <Link href="/screener" className="text-accent underline">自訂篩選</Link> 存一組。</span> : (
            <select value={screen} onChange={(e) => setScreen(e.target.value)} className={input}>
              <option value="">選擇…</option>
              {screens?.map((s) => <option key={s.name} value={s.query}>{s.name}</option>)}
            </select>
          )}
        </label>
      )}
      {kind === "portfolio" && (
        <p className="mt-2 text-xs text-muted">{hasPortfolio ? "已經設定過持倉提醒了。" : "投資組合裡有設目標價或失效價的持股，收盤到價時通知。"}</p>
      )}
      <label className="mt-3 flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={telegram} onChange={(e) => setTelegram(e.target.checked)} />也傳到 Telegram</label>
      <button type="submit" disabled={!alert} className="mt-3 rounded-md bg-accent px-4 py-1.5 font-bold text-white disabled:opacity-40">新增</button>
    </form>
  );
}
