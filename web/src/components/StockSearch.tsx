"use client";

/** 頁首搜尋：輸入代號或名稱，跳到個股頁。第一次聚焦時才下載快照（同一次瀏覽只下載一次）。 */
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useSnapshotLazy } from "@/hooks/useSnapshot";

export default function StockSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [expanded, setExpanded] = useState(false);       // 手機：點放大鏡才展開輸入框
  const { snap, start } = useSnapshotLazy();
  const inputRef = useRef<HTMLInputElement>(null);

  const hits = useMemo(() => {
    const t = q.trim().toUpperCase();
    if (!snap || !t) return [];
    const starts = snap.rows.filter((r) => String(r.code).startsWith(t) || String(r.name ?? "").toUpperCase().startsWith(t));
    const inc = snap.rows.filter((r) => !starts.includes(r) && String(r.name ?? "").toUpperCase().includes(t));
    return [...starts, ...inc].slice(0, 8);
  }, [snap, q]);

  function go(code: string) {
    setQ("");
    setOpen(false);
    setExpanded(false);
    inputRef.current?.blur();
    router.push(`/stock/${code}`);
  }

  return (
    <div className="relative">
      <button type="button" aria-label="搜尋股票" onClick={() => { setExpanded(true); start(); setTimeout(() => inputRef.current?.focus(), 0); }}
        className="flex h-8 w-8 items-center justify-center rounded-md text-muted hover:text-ink sm:hidden">
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      </button>
      <input
        ref={inputRef}
        type="search"
        value={q}
        placeholder="搜尋代號或名稱"
        aria-label="搜尋股票代號或名稱"
        role="combobox"
        aria-expanded={open && hits.length > 0}
        aria-controls="stock-search-list"
        onFocus={() => { start(); setOpen(true); }}
        onBlur={() => setTimeout(() => { setOpen(false); setExpanded(false); }, 150)}
        onChange={(e) => { setQ(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, hits.length - 1)); }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          if (e.key === "Enter") {
            const h = hits[active];
            if (h) go(String(h.code));
            else if (/^[0-9A-Z]{4,6}$/i.test(q.trim())) go(q.trim().toUpperCase());
          }
          if (e.key === "Escape") { setOpen(false); setExpanded(false); }
        }}
        className={`${expanded ? "fixed inset-x-3 top-2.5 z-50 h-9 shadow-lg" : "hidden"} rounded-md border border-line bg-surface-2 px-2.5 py-1 text-base text-ink placeholder:text-muted sm:static sm:block sm:h-auto sm:w-48 sm:text-sm sm:shadow-none`}
      />
      {open && hits.length > 0 && (
        <ul id="stock-search-list" role="listbox" className="fixed inset-x-3 top-[52px] z-50 overflow-hidden rounded-lg border border-line bg-surface shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-auto sm:mt-1 sm:w-64">
          {hits.map((r, i) => (
            <li key={String(r.code)} role="option" aria-selected={i === active}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => go(String(r.code))}
                className={`flex w-full items-baseline gap-2 px-3 py-2 text-left text-sm ${i === active ? "bg-surface-2" : ""}`}>
                <span className="num text-muted">{r.code}</span>
                <span className="truncate text-ink">{r.name}</span>
                <span className="ml-auto text-xs text-muted">{r.market === "TPEX" ? "櫃" : ""}{r.sec_type === "etf" ? " ETF" : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
