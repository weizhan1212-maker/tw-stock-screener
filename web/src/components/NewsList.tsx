"use client";

import { useEffect, useState } from "react";

interface Item { title: string; source: string; link: string; time: string }

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (m < 60) return `${m} 分鐘前`;
  if (m < 60 * 24) return `${Math.round(m / 60)} 小時前`;
  return `${Math.round(m / 1440)} 天前`;
}

/** 新聞：只顯示標題、來源、時間，點擊到原網站閱讀。 */
export default function NewsList({ q = "台股", fallback, limit = 12, more = false }: { q?: string; fallback?: string; limit?: number; more?: boolean }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const [all, setAll] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    const get = (k: string) => fetch(`/api/news?q=${encodeURIComponent(k)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j) => (j.items ?? []) as Item[]);
    // 先用精確關鍵字，沒有結果再用較寬的關鍵字
    get(q)
      .then((a) => (a.length || !fallback ? a : get(fallback)))
      .then(setItems)
      .catch(() => setError(true));
  }, [q, fallback]);
  if (error) return <p className="text-sm text-muted">新聞暫時無法載入。</p>;
  if (!items) return <p className="text-sm text-muted">載入新聞中…</p>;
  if (!items.length) return <p className="text-sm text-muted">目前沒有相關新聞。</p>;
  return (
    <>
    <ul className="divide-y divide-line">
      {items.slice(0, all ? undefined : limit).map((n) => (
        <li key={n.link}>
          <a href={n.link} target="_blank" rel="noopener noreferrer" className="block py-2.5 hover:text-accent">
            <span className="block text-sm leading-snug text-ink">{n.title}</span>
            <span className="mt-0.5 block text-xs text-muted">{n.source}・{ago(n.time)}</span>
          </a>
        </li>
      ))}
    </ul>
    {more && !all && items.length > limit && (
      <button type="button" onClick={() => setAll(true)} className="mt-2 text-sm text-accent hover:underline">更多新聞（{items.length - limit} 則）</button>
    )}
    </>
  );
}
