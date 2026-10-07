"use client";

import { useEffect, useState } from "react";

export interface SavedScreen { name: string; query: string; cols: string[] | null }

/** 已儲存的篩選組合（條件、股票池、排序、額外欄位），存在伺服器，換裝置也看得到。 */
export default function SavedScreens({ currentQuery, onLoad }: { currentQuery: string; onLoad: (query: string) => void }) {
  const [list, setList] = useState<SavedScreen[] | null>(null);
  const [name, setName] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/me/screens")
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setList(j.screens ?? []);
      })
      .catch((e) => { setList([]); setMsg(`讀取失敗：${e.message}`); });
  }, []);

  async function put(next: SavedScreen[]) {
    const r = await fetch("/api/me/screens", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ screens: next }) });
    if (!r.ok) { setMsg(`儲存失敗：HTTP ${r.status}`); return; }
    setList(next);
    setMsg("");
  }

  function save() {
    const n = name.trim().slice(0, 40);
    if (!n || !list) return;
    put([...list.filter((s) => s.name !== n), { name: n, query: currentQuery, cols: null }]);
    setName("");
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <p className="mb-2 text-sm font-medium text-ink">我的篩選組合</p>
      {list === null ? (
        <p className="text-xs text-muted">載入中…</p>
      ) : (
        <>
          {list.length === 0 && <p className="mb-2 text-xs text-muted">還沒有儲存的組合。設定好條件後，在下面取名字存起來。</p>}
          <ul className="mb-2 space-y-1">
            {list.map((s) => (
              <li key={s.name} className="flex items-center gap-2 text-sm">
                <button type="button" onClick={() => onLoad(s.query)} className="min-w-0 flex-1 truncate text-left text-accent hover:underline">
                  {s.name}
                </button>
                <button type="button" aria-label={`刪除組合：${s.name}`} onClick={() => put(list.filter((x) => x.name !== s.name))}
                  className="px-1 text-muted hover:text-up">×</button>
              </li>
            ))}
          </ul>
          <div className="flex gap-1.5">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder="組合名稱"
              aria-label="組合名稱" className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink" />
            <button type="button" onClick={save} disabled={!name.trim()}
              className="rounded-md border border-line px-2.5 py-1.5 text-sm text-ink hover:border-accent hover:text-accent disabled:opacity-40">
              儲存
            </button>
          </div>
        </>
      )}
      {msg && <p className="mt-2 text-xs text-up">{msg}</p>}
    </div>
  );
}
