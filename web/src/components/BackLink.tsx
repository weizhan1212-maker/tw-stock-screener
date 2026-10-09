"use client";

/**
 * 「← 上一頁」：從站內哪一頁點進來，就顯示那一頁的名稱並回到那裡（保留原本的篩選、排序與捲動位置）。
 * 站內瀏覽紀錄由 <NavTracker />（放在 layout）記在 sessionStorage；直接開網址時退回 fallback。
 */
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

const KEY = "nav-stack";
const NAMES: [RegExp, string][] = [
  [/^\/$/, "市場總覽"], [/^\/strategy$/, "策略選股"], [/^\/strategy\//, "策略"], [/^\/screener/, "自訂篩選"], [/^\/market\/index/, "指數"], [/^\/market/, "市場總覽"],
  [/^\/industry/, "產業"], [/^\/etf/, "ETF"], [/^\/ranking/, "排行榜"], [/^\/backtest/, "回測"],
  [/^\/watchlist/, "自選股"], [/^\/portfolio/, "投資組合"], [/^\/alerts/, "警報"], [/^\/compare/, "比較"], [/^\/stock\//, "上一檔股票"],
];

function read(): string[] {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? "[]"); } catch { return []; }
}

/** 放在 layout：記錄站內走過的頁面（返回時往回退一格） */
export function NavTracker() {
  const path = usePathname();
  useEffect(() => {
    try {
      const st = read();
      if (st[st.length - 1] === path) return;
      if (st[st.length - 2] === path) st.pop();          // 按了返回
      else st.push(path);
      sessionStorage.setItem(KEY, JSON.stringify(st.slice(-30)));
    } catch { /* 無痕模式等不能存就算了 */ }
  }, [path]);
  return null;
}

const noop = () => () => {};

export default function BackLink({ fallback, fallbackLabel }: { fallback: string; fallbackLabel: string }) {
  const router = useRouter();
  const path = usePathname();
  const raw = useSyncExternalStore(noop, () => { try { return sessionStorage.getItem(KEY) ?? "[]"; } catch { return "[]"; } }, () => "[]");
  let prev: string | undefined;
  try { prev = (JSON.parse(raw) as string[]).filter((p) => p !== path).at(-1); } catch { /* 忽略 */ }
  if (!prev) return <Link href={fallback} className="text-muted hover:text-ink">← {fallbackLabel}</Link>;
  const label = NAMES.find(([re]) => re.test(prev))?.[1] ?? "上一頁";
  return <button type="button" onClick={() => router.back()} className="text-muted hover:text-ink">← {label}</button>;
}
