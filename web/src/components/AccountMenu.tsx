"use client";

/** 頁首右上角：圓形字母頭像（不直接顯示 email），點開才看到帳號、成員管理、深淺色、登出 */
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

function subscribe(cb: () => void) {
  const obs = new MutationObserver(cb);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => obs.disconnect();
}
const getTheme = () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light");

export default function AccountMenu({ email, admin, signOut }: { email: string; admin: boolean; signOut: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const theme = useSyncExternalStore(subscribe, getTheme, () => "light");
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("theme", next); } catch { /* 忽略 */ }
  }
  const item = "block w-full rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-surface-2";
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="帳號選單"
        className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold uppercase text-white">
        {email.slice(0, 1)}
      </button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-line bg-surface p-1.5 shadow-lg">
          <p className="truncate px-3 py-1.5 text-xs text-muted" title={email}>{email}</p>
          {admin && <Link href="/admin" className={item} onClick={() => setOpen(false)}>成員管理</Link>}
          <button type="button" className={item} onClick={toggleTheme}>{theme === "dark" ? "切換成淺色" : "切換成深色"}</button>
          <form action={signOut}><button type="submit" className={item}>登出</button></form>
        </div>
      )}
    </div>
  );
}
