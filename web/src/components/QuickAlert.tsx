"use client";

/**
 * 個股頁「🔔 警報」：不跳頁，直接彈出小視窗設定這檔股票的條件警報。
 * 列出這檔已有的警報（可刪除），新增後存到同一份警報清單；完整管理仍在 /alerts。
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { NumInput } from "@/components/Screener";
import { type Alert, describe, MAX_ALERTS, type Note, PRICE_FIELDS } from "@/lib/alerts";
import { FIELD_MAP } from "@/lib/fields";

interface Data { alerts: Alert[]; lastRead?: string; inbox: Note[] }
const uid = () => Math.random().toString(36).slice(2, 10);

export default function QuickAlert({ code, name, close }: { code: string; name: string; close?: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm text-muted hover:border-accent hover:text-ink">🔔 警報</button>
      {open && <Dialog code={code} name={name} close={close} onClose={() => setOpen(false)} />}
    </>
  );
}

function Dialog({ code, name, close, onClose }: { code: string; name: string; close?: number | null; onClose: () => void }) {
  const [data, setData] = useState<Data | null>(null);
  const [msg, setMsg] = useState("");
  const [saving, setSaving] = useState(false);
  const [field, setField] = useState("close");
  const [op, setOp] = useState<"ge" | "le">("ge");
  const [value, setValue] = useState<number | undefined>(undefined);
  const [telegram, setTelegram] = useState(true);

  useEffect(() => {
    fetch("/api/me/alerts").then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setData(j);
    }).catch((e) => setMsg(`讀取失敗：${e.message}`));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";                 // 彈窗開著時背景不捲動
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  async function save(alerts: Alert[], done: string) {
    if (!data) return;
    setSaving(true);
    const r = await fetch("/api/me/alerts", { method: "PUT", headers: { "content-type": "application/json" },
      body: JSON.stringify({ alerts, lastRead: data.lastRead }) }).catch(() => null);
    setSaving(false);
    if (r?.ok) { setData({ ...data, alerts }); setMsg(done); setValue(undefined); }
    else setMsg(`儲存失敗：${r ? `HTTP ${r.status}` : "網路不穩"}`);
  }

  const mine = data?.alerts.filter((a) => a.kind === "price" && a.code === code) ?? [];
  const full = !!data && data.alerts.length >= MAX_ALERTS;
  const input = "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`${name} 警報`} onClick={(e) => e.stopPropagation()}
        className="max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] text-sm text-ink shadow-2xl sm:max-w-md sm:rounded-2xl sm:pb-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">🔔 {name} {code} 警報</h2>
          <button type="button" onClick={onClose} aria-label="關閉" className="px-2 text-xl leading-none text-muted hover:text-ink">×</button>
        </div>
        {close != null && <p className="mt-0.5 text-xs text-muted">最近收盤 {close}</p>}

        {!data && !msg && <p className="mt-3 text-muted">讀取中…</p>}
        {data && (
          <>
            {mine.length > 0 && (
              <ul className="mt-3 divide-y divide-line rounded-md border border-line">
                {mine.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 px-3 py-2">
                    <span className={`min-w-0 flex-1 text-xs ${a.enabled ? "text-ink" : "text-muted line-through"}`}>{describe(a)}</span>
                    <button type="button" disabled={saving} onClick={() => save(data.alerts.filter((x) => x.id !== a.id), "已刪除")} className="text-xs text-muted hover:text-up">刪除</button>
                  </li>
                ))}
              </ul>
            )}

            {full ? <p className="mt-3 text-muted">警報已達上限 {MAX_ALERTS} 個，請先到警報頁刪掉一些。</p> : (
              <form className="mt-3 space-y-2" onSubmit={(e) => {
                e.preventDefault();
                if (value == null) return;
                save([...data.alerts, { id: uid(), kind: "price", name: `${code} ${name}`.slice(0, 40), enabled: true, telegram, code, field, op, value }], "已新增，盤後符合條件時會通知你");
              }}>
                <div className="flex items-end gap-2">
                  <label className="flex flex-1 flex-col gap-1 text-xs text-muted">條件
                    <select value={field} onChange={(e) => setField(e.target.value)} className={input}>
                      {PRICE_FIELDS.map((k) => <option key={k} value={k}>{FIELD_MAP[k]?.label ?? k}</option>)}
                    </select>
                  </label>
                  <select value={op} onChange={(e) => setOp(e.target.value as "ge" | "le")} aria-label="比較方式" className="rounded-md border border-line bg-surface px-1.5 py-1.5">
                    <option value="ge">≥</option><option value="le">≤</option>
                  </select>
                  <NumInput key={mine.length} value={value} onChange={setValue} label="數值" />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted"><input type="checkbox" checked={telegram} onChange={(e) => setTelegram(e.target.checked)} />也傳到 Telegram</label>
                <p className="text-xs text-muted">每個交易日盤後檢查；條件從「不成立」變「成立」時通知一次。</p>
                <button type="submit" disabled={value == null || saving} className="w-full rounded-md bg-accent py-2 font-bold text-white disabled:opacity-40">{saving ? "儲存中…" : "新增警報"}</button>
              </form>
            )}
          </>
        )}
        {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
        <Link href={`/alerts?code=${code}`} className="mt-3 block text-center text-xs text-accent hover:underline">管理全部警報、Telegram 綁定 →</Link>
      </div>
    </div>
  );
}
